import {Column, Entity, PrimaryGeneratedColumn} from "typeorm";

@Entity()
export class Cronjob {
    @PrimaryGeneratedColumn()
    id: number

    @Column({type: 'datetime', nullable: true})
    sleepUntil?: Date

    @Column({nullable: true})
    intervall?: string

    @Column({default: false})
    autoRemove?: boolean
}