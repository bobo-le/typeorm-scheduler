# Installation
    npm install typeorm-scheduler
    
# Example
```typescript
import {Scheduler} from 'typeorm-scheduler';
import { createConnection } from 'typeorm';

await createConnection({
    type: 'sqlite',
    database: './example.db',
    entities: [Cronjob],
    logging: true,
    synchronize: true,
  });

const scheduler = new Scheduler({
  // your entity
  entity: Cronjob,

  // callback for new jobs
  async onNewJob(job: any) {
      // is called when a new job has been received
      // process your job here
  },
})


scheduler.start()
```

A full example is shown in the example directory.

# One-time jobs
To create a one-time job you must only set the `sleepUntil` field of your entity.<br>
The value must be a `unix timestamp`.<br>
Every job whose sleepUntil field is in the past is successively processed.
```typescript
import {getRepository} from 'typeorm';
import moment from 'moment'

getRepository(Cronjob).insert({..., sleepUntil: moment().format('X')})
```

You can set the sleepUntil value to a particular time in the future.<br>
The executing will be deferred until this time.

# Repeated jobs
To create a repeated job set the `interval` field to your desired cron-string.<br>
The following library is used for parsing the cronstring, so see there for more informations: 
https://github.com/harrisiirak/cron-parser#readme

The job in the following example will be executed every five minutes.
```typescript
import {getRepository} from 'typeorm';
import moment from 'moment'

getRepository(Cronjob).insert({..., sleepUntil: moment().format('X'), interval: '*/5 * * * *'})
```

All repeated jobs will be endless executed. <br>
If you want to stop the executing at a given time, set the `repeatUntil` field to your desired time.
```typescript
import {getRepository} from 'typeorm';
import moment from 'moment'

getRepository(Cronjob).insert({..., interval: '*/5 * * * *', repeatUntil: moment('2021-01-01')})
```

# Stopped jobs
If a one-time or a repeated job is finished, his `sleepUntil` field will be set to null.
This marks the job as expired.

If you want to remove the job from the database after expiring, set the `autoRemove` field to `true`

# Schedulerconfig
```typescript
interface SchedulerConfig {
  /**
   * Your cronjob entity
   */
  entity: any;

  /**
   * Duration to interrupt executing before every iteration. 
   * Unit in milliseconds.
   * default: 0
   */
  nextDelay?: number;

  /**
   * Time to wait if no new job was found. 
   * Unit in milliseconds.
   * default: 100000
   */
  idleDelay?: number;

  /**
   * Duration to lock the current job in the database. 
   * Be sure that the execution finishes in this time. 
   * Unit in milliseconds.
   * default: 600000
   */
  lockDuration?: number;

  /**
   * Field name in your entity.
   * default: sleepUntil
   */
  sleepUntilFieldPath?: string;

  /**
   * Field name in your entity.
   * default: interval
   */
  intervalFieldPath?: string;

  /**
   * Field name in your entity.
   * default: repeatUntil
   */
  repeatUntilFieldPath?: string;

  /**
   * Field name in your entity.
   * default: autoRemove
   */
  autoRemoveFieldPath?: string;

  /**
   * Your callback function that gets called if a new job was found.
   * @param job founded job
   */
  onNewJob?(job: any): (any | Promise<any>);

  /**
   * Callback will be called before starting.
   */
  onStart?(): (any | Promise<any>);

  /**
   * Callback be called at ending.
   */
  onStop?(): (any | Promise<any>);

  /**
   * Callback will be called if no new job was found and before idleSleep will be called.
   */
  onIdle?(): (any | Promise<any>);

  /**
   *
   * @param err
   */
  onError?(err: any): (any | Promise<any>);
}
```
