import * as migration_20261111_214315_initial from './20261111_214315_initial';

export const migrations = [
  {
    up: migration_20261111_214315_initial.up,
    down: migration_20261111_214315_initial.down,
    name: '20261111_214315_initial'
  },
];
