import * as parser from 'cron-parser';
import { promise as sleep } from 'es6-sleep';
import moment from 'moment';
import { getConnection, LessThan, Not, Repository } from 'typeorm';
import { Cronjob } from '../cronjob';

/**
 * Configuration object interface.
 */
export interface SchedulerConfig {
  repository: Repository<any> | (() => Repository<any>);
  entity: any,
  condition?: any;
  nextDelay?: number; // wait before processing next job
  reprocessDelay?: number; // wait before processing the same job again
  idleDelay?: number; // when there is no jobs for processing, wait before continue
  lockDuration?: number; // the time of milliseconds that each job gets locked (we have to make sure that the job completes in that time frame)
  sleepUntilFieldPath?: string;
  intervalFieldPath?: string;
  repeatUntilFieldPath?: string;
  autoRemoveFieldPath?: string;

  onNewJob?(doc: any): (any | Promise<any>);

  onStart?(): (any | Promise<any>);

  onStop?(): (any | Promise<any>);

  onIdle?(): (any | Promise<any>);

  onError?(err: any): (any | Promise<any>);
}

/**
 * Main class for converting a collection into cron.
 */
export class Scheduler {
  protected running = false;
  protected processing = false;
  protected idle = false;
  protected readonly config: SchedulerConfig;

  /**
   * Class constructor.
   * @param config Configuration object.
   */
  public constructor(config: SchedulerConfig) {
    this.config = {
      onNewJob: (doc) => doc,
      onError: console.error,
      nextDelay: 0,
      reprocessDelay: 0,
      idleDelay: 10000,
      lockDuration: 600000,
      sleepUntilFieldPath: 'sleepUntil',
      intervalFieldPath: 'interval',
      repeatUntilFieldPath: 'repeatUntil',
      autoRemoveFieldPath: 'autoRemove',
      ...config,
    };
  }

  /**
   * Returns the used job entity
   * The collection can be provided in the config as an instance or a function.
   */
  protected getRepository(): Repository<any> {
    return typeof this.config.repository === 'function'
      ? this.config.repository()
      : this.config.repository;
  }

  protected getEntity(): any {
    return this.config.entity;
  }

  /**
   * Tells if the process is started.
   */
  public isRunning() {
    return this.running;
  }

  /**
   * Tells if a document is processing.
   */
  public isProcessing() {
    return this.processing;
  }

  /**
   * Tells if the process is idle.
   */
  public isIdle() {
    return this.idle;
  }

  /**
   * Starts the scheduler.
   */
  public async start() {
    if (!this.running) {
      this.running = true;

      if (this.config.onStart) {
        await this.config.onStart.call(this);
      }

      // call the tick-method at the end of this event loop
      process.nextTick(this.tick.bind(this));
    }
  }

  /**
   * Stops the scheduler.
   */
  public async stop() {
    this.running = false;

    if (this.processing) {
      // processing is not completed. so wait 300ms and call the method again on the end of event loop
      await sleep(300);
      return process.nextTick(this.stop());
    }

    if (this.config.onStop) {
      await this.config.onStop();
    }
  }

  /**
   * Private method which runs the heartbit tick.
   */
  protected async tick() {
    if (!this.running) {
      return;
    }
    await sleep(this.config.nextDelay);
    if (!this.running) {
      return;
    }

    this.processing = true;
    try {
      // check if a new job exists and lock him
      const job = await this.checkNextAndLock();

      if (!job) {
        //no job exists, go to idle
        this.processing = false;
        if (!this.idle) {
          // make sure onIdle gets only called once
          this.idle = true;
          if (this.config.onIdle) {
            await this.config.onIdle();
          }
        }
        await sleep(this.config.idleDelay);
      } else {
        this.idle = false;
        if (this.config.onNewJob) {
          await this.config.onNewJob(job);
        }

        // calc new times and update job
        await this.reschedule(job);
        this.processing = false;
      }
    } catch (err) {
      await this.config.onError.call(this, err);
    }

    // call the next tick at the end of the event loop
    process.nextTick(() => this.tick());
  }

  /**
   * Locks the next job document for processing and returns it.
   */
  protected async checkNextAndLock() {
    const sleepUntil = moment().add(this.config.lockDuration, 'milliseconds').toDate();
    const currentDate = moment().add(1, 'hour').toISOString();

    const tmp = await this.getRepository().find();

    // use transaction mode to make sure that concurrent schedulers doesnt access the same object
    return await getConnection().transaction(async entityManager => {
      const origJob: any = await entityManager.findOne(Cronjob, {
        where: {
          [this.config.sleepUntilFieldPath]: Not(null),
          [this.config.sleepUntilFieldPath]: LessThan(currentDate),
        },
      });

      if (origJob) {
        // a job was found, so lock this job and return his orig values
        const updated = origJob;
        updated[this.config.sleepUntilFieldPath] = sleepUntil;
        await entityManager.save(updated);
      }

      return origJob;
    });
  }

  /**
   * Returns the next date when a job document can be processed or `null` if the
   * job has expired.
   * @param doc Mongo document.
   */
  protected getNextStart(doc: any): Date {
    if (!this.config.intervalFieldPath) {
      return null;
    }

    const available = moment(this.config.sleepUntilFieldPath); // first available next date
    const future = moment(available).add(this.config.reprocessDelay, 'milliseconds'); // date when the next start is possible

    try {
      const interval = parser.parseExpression(this.config.intervalFieldPath, {
        currentDate: future.toDate(),
        endDate: this.config.repeatUntilFieldPath,
      });
      const next = interval.next().toDate();
      const now = moment().toDate();
      return next < now ? now : next; // process old recurring jobs only once
    } catch (err) {
      return null;
    }
  }

  /**
   * Tries to reschedule a job document, to mark it as expired or to delete a job
   * if `autoRemove` is set to `true`.
   * @param doc Mongo document.
   */
  public async reschedule(doc: any): Promise<void> {
    const nextStart = this.getNextStart(doc);
    const _id = doc._id;

    // TODO and change here
    // if (!nextStart && this.config.autoRemoveFieldPath) {
    // remove if auto-removable and not recuring
    //     await this.getCollection().deleteOne({_id});
    // } else if (!nextStart) { // stop execution
    //     await this.getCollection().updateOne({_id}, {
    //         $set: {[this.config.sleepUntilFieldPath]: null},
    //     });
    // } else { // reschedule for reprocessing in the future (recurring)
    //     await this.getCollection().updateOne({_id}, {
    //         $set: {[this.config.sleepUntilFieldPath]: nextStart},
    //     });
    // }
  }

}
