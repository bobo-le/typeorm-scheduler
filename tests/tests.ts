import { createConnection, getRepository } from 'typeorm';
import { Cronjob } from '../example/cronjob';
import moment = require('moment');
import { Scheduler } from '../src/scheduler';
import { promise as sleep } from 'es6-sleep';
import assert from 'assert';
import Fs from 'fs'

describe('Scheduler', function() {
  before(async function() {
    await createConnection({
      type: 'sqlite',
      database: './test-database.db',
      entities: [Cronjob],
      logging: true,
      synchronize: true,
    });
  });

  after(function() {
    // remove test database
    console.log('TEST')
    Fs.unlinkSync('./test-database.db')
  });

  afterEach(async function() {
    await getRepository(Cronjob).clear();
  });

  context('SleepUntil Tests', function() {
    it('should execute many', async function() {
      let times = 0;
      await getRepository(Cronjob).insert({ sleepUntil: moment().subtract(10, 'seconds').format('X') });
      await getRepository(Cronjob).insert({ sleepUntil: null });
      await getRepository(Cronjob).insert({ sleepUntil: moment().subtract(10, 'seconds').format('X') });

      const scheduler = new Scheduler({
        entity: Cronjob,
        autoRemoveFieldPath: 'autoRemove',
        intervalFieldPath: 'interval',
        sleepUntilFieldPath: 'sleepUntil',
        async onNewJob(doc: any) {
          times++;
        },
      });

      await scheduler.start();
      await sleep(1000);
      await scheduler.stop();

      assert.equal(times, 2);
    });

    it('should not execute a cronjob if its in future', async function() {
      let times = 0;
      await getRepository(Cronjob).insert({ sleepUntil: moment().add(100, 'seconds').format('X') });

      const scheduler = new Scheduler({
        entity: Cronjob,
        autoRemoveFieldPath: 'autoRemove',
        intervalFieldPath: 'interval',
        sleepUntilFieldPath: 'sleepUntil',
        async onNewJob(doc: any) {
          times++;
        },
      });

      await scheduler.start();
      await sleep(1000);
      await scheduler.stop();

      assert.equal(times, 0);
    });

    it('should not execute a cronjob after its processed and its no a intervall', async function() {
      let times = 0;
      const job = await getRepository(Cronjob).insert({ sleepUntil: moment().subtract(100, 'seconds').format('X') });

      const scheduler = new Scheduler({
        entity: Cronjob,
        autoRemoveFieldPath: 'autoRemove',
        intervalFieldPath: 'interval',
        sleepUntilFieldPath: 'sleepUntil',
        async onNewJob(doc: any) {
          times++;
        },
      });

      await scheduler.start();
      await sleep(1000);
      await scheduler.stop();

      assert.equal(times, 1);
      const check = await getRepository(Cronjob).findOne(job.identifiers[0]);
      assert.equal(check.sleepUntil, null);
    });
  });

  context('AutoRemove Tests', function() {
    it('should be deleted after executing and not a intervall', async function() {
      let times = 0;
      await getRepository(Cronjob).insert({
        autoRemove: true,
        sleepUntil: moment().subtract(10, 'seconds').format('X'),
      });

      const scheduler = new Scheduler({
        entity: Cronjob,
        autoRemoveFieldPath: 'autoRemove',
        intervalFieldPath: 'interval',
        sleepUntilFieldPath: 'sleepUntil',
        async onNewJob(doc: any) {
          times++;
        },
      });

      await scheduler.start();
      await sleep(1000);
      await scheduler.stop();

      assert.equal(times, 1);
      const check = await getRepository(Cronjob).count();
      assert.equal(check, 0);
    });
  });

  context('Intervall Tests', function() {
    this.timeout(4000);
    it('should be executed repeatly', async function() {
      let times = 0;
      await getRepository(Cronjob).insert({
        interval: '* * * * * *',
        sleepUntil: moment().subtract(10, 'seconds').format('X'),
      });

      const scheduler = new Scheduler({
        entity: Cronjob,
        autoRemoveFieldPath: 'autoRemove',
        intervalFieldPath: 'interval',
        sleepUntilFieldPath: 'sleepUntil',
        lockDuration: 0,
        idleDelay: 100,
        async onNewJob(doc: any) {
          times++;
        },
      });

      await scheduler.start();
      await sleep(3100);
      await scheduler.stop();

      assert.notEqual(times, 0);
      assert.notEqual(times, 1);
      assert.notEqual(times, 2);

      const check = await getRepository(Cronjob).findOne();
      assert.notEqual(check.sleepUntil, null);
    });

    it('should be executed repeatly until repeatUntil is expired', async function() {
      let times = 0;
      await getRepository(Cronjob).insert({
        repeatUntil: moment().add(2000, 'milliseconds').toDate(),
        interval: '* * * * * *',
        sleepUntil: moment().subtract(10, 'seconds').format('X'),
      });

      const scheduler = new Scheduler({
        entity: Cronjob,
        autoRemoveFieldPath: 'autoRemove',
        intervalFieldPath: 'interval',
        sleepUntilFieldPath: 'sleepUntil',
        repeatUntilFieldPath: 'repeatUntil',
        lockDuration: 0,
        idleDelay: 100,
        async onNewJob(doc: any) {
          times++;
        },
      });

      await scheduler.start();
      await sleep(3100);
      await scheduler.stop();

      assert.notEqual(times, 0);
      assert.notEqual(times, 1);
      assert.notEqual(times, 2);

      const check = await getRepository(Cronjob).findOne();
      assert.equal(check.sleepUntil, null);
    });
  });
});
