import * as parser from 'cron-parser';
import { promise as sleep } from 'es6-sleep';
import moment from 'moment';
import { getConnection, getRepository, LessThan, Not, Repository } from 'typeorm';

/**
 * Configuration object interface.
 */
export interface SchedulerConfig {
  /**
   * Your crnjob entity
   */
  entity: any;

  /**
   * Duration to interrupt executing before every iteration. unit in milliseconds
   * default: 0
   */
  nextDelay?: number;

  /**
   * Time to wait if no new job was found. unit in milliseconds
   * default: 100000
   */
  idleDelay?: number;

  /**
   * Duration to lock the current job in the database. be sure that the execution finishes in this time. unit in milliseconds
   * default: 600000
   */
  lockDuration?: number;

  /**
   * Field name in your entity
   * default: sleepUntil
   */
  sleepUntilFieldPath?: string;

  /**
   * Field name in your entity
   * default: interval
   */
  intervalFieldPath?: string;

  /**
   * Field name in your entity
   * default: repeatUntil
   */
  repeatUntilFieldPath?: string;

  /**
   * Field name in your entity
   * default: autoRemove
   */
  autoRemoveFieldPath?: string;

  /**
   * Your callback function that gets called if a new job was found
   * @param job founded job
   */
  onNewJob?(job: any): (any | Promise<any>);

  /**
   * Callback will be called before starting
   */
  onStart?(): (any | Promise<any>);

  /**
   * Callback be called at ending
   */
  onStop?(): (any | Promise<any>);

  /**
   * Callback will be called if no new job was found and before idleSleep will be called
   */
  onIdle?(): (any | Promise<any>);

  /**
   *
   * @param err
   */
  onError?(err: any): (any | Promise<any>);
}


export class Scheduler {
  private running = false;
  private processing = false;
  private idle = false;
  private readonly config: SchedulerConfig;

  /**
   *
   * @param config SchedulerConfig-instance with your overrides
   */
  public constructor(config: SchedulerConfig) {
    this.config = {
      onNewJob: (doc) => doc,
      onError: console.error,
      nextDelay: 0,
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
   * Returns the proper repository for the used entity
   */
  private getRepository(): Repository<any> {
    return getRepository(this.config.entity);
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
      return process.nextTick(this.stop.bind(this));
    }

    if (this.config.onStop) {
      await this.config.onStop();
    }
  }

  /**
   * Private method which runs the heartbit tick.
   */
  private async tick() {
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
        await this.rescheduleSleep(job);
        this.processing = false;
      }
    } catch (err) {
      await this.config.onError.call(this, err);
    }

    // call the next tick at the end of the event loop
    process.nextTick(() => this.tick());
  }

  /**
   * Locks the next job document for processing and returns it if it exists. Otherwise returns null.
   */
  private async checkNextAndLock(): Promise<any | undefined> {
    const lockDuration = moment().add(this.config.lockDuration, 'milliseconds').format('X');
    const currentDate = moment().format('X');

    // use transaction mode to make sure that concurrent schedulers doesnt access the same object
    return await getConnection().transaction(async entityManager => {
      const origJob: any = await entityManager.findOne(this.config.entity, {
        where: {
          [this.config.sleepUntilFieldPath]: Not(null),
          [this.config.sleepUntilFieldPath]: LessThan(currentDate),
        },
      });

      if (origJob) {
        // a job was found, so lock this job
        await entityManager.update(this.config.entity, origJob.id, {[this.config.sleepUntilFieldPath]: lockDuration})
      }

      return origJob;
    });
  }

  /**
   * Returns the next timestamp when a job document can be processed or `null` if the
   * job has expired.
   * @param job Cronjob to check
   */
  private getNextStart(job: any): string | null {
    if (!this.config.intervalFieldPath) {
      return null;
    }

    // first available next date
    const available = moment(job[this.config.sleepUntilFieldPath], 'X');

    // date when the next start is possible
    const future = moment(available);

    try {
      const interval = parser.parseExpression(job[this.config.intervalFieldPath], {
        currentDate: future.toDate(),
        endDate: job[this.config.repeatUntilFieldPath],
      });

      const next = moment(interval.next().toDate()).format('X');
      const now = moment().format('X');

      return next < now ? now : next;
    } catch (err) {
      return null;
    }
  }

  /**
   * Tries to reschedule a job document, to mark it as expired or to delete a job
   * if `autoRemove` is set to `true`.
   * @param job Cronjob to update
   */
  private async rescheduleSleep(job: any): Promise<void> {
    const nextStart = this.getNextStart(job);

    // if nexStart is null, then the cronjob is expired and shall not be executed again.
    // to archive this, set the field in the db to null, or if the job should be deleted, the the entire job
    if (!nextStart && job[this.config.autoRemoveFieldPath]) {
      // delete the job from db
      await this.getRepository().delete(job.id);
    } else if (!nextStart) {
      // set sleepUntil to null
      await this.getRepository().update(job.id, { [this.config.sleepUntilFieldPath]: null });
    } else {
      // update the job with his new sleepUntil field in the future
      // @ts-ignore
      await this.getRepository().update(job.id, { [this.config.sleepUntilFieldPath]: nextStart });
    }
  }

}
