import { Scheduler } from '../index';
import { createConnection, getRepository } from 'typeorm';
import { Cronjob } from './cronjob';
import moment = require('moment');

async function connect() {
  return await createConnection({
    type: 'sqlite',
    database: './example.db',
    entities: [Cronjob],
    logging: true,
    synchronize: true,
  });
}

async function clearDatabase() {
  await getRepository(Cronjob).clear();
}

async function seedDatabase() {
  // repeat every five minutes
  await getRepository(Cronjob).insert({ sleepUntil: moment().format('X'), interval: '*/5 * * * *' });
}

// init scheduler
async function main() {
  // connect to db
  await connect();

  // clear and seed db
  await clearDatabase();
  await seedDatabase();

  // TODO make a base cronjob class to extending

  const scheduler = new Scheduler({
    entity: Cronjob,
    autoRemoveFieldPath: 'autoRemove',
    intervalFieldPath: 'interval',
    sleepUntilFieldPath: 'sleepUntil',
    onNewJob(job: any) {
      console.log(job);
    },
    onStart(): any | Promise<any> {
      console.log('starting');
    },
  });

  await scheduler.start();
}

main();
