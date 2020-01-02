import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
export class Cronjob {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ nullable: true })
  sleepUntil?: string;

  @Column({ nullable: true })
  interval?: string;

  @Column({ default: false })
  autoRemove?: boolean;
}
