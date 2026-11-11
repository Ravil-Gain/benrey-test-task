import * as migration_20261110_152856_initial from './20261110_152856_initial';
import * as migration_20261110_165322_media_original_name_roles from './20261110_165322_media_original_name_roles';
import * as migration_20261111_114409_ticket_filter_indexes from './20261111_114409_ticket_filter_indexes';

export const migrations = [
  {
    up: migration_20261110_152856_initial.up,
    down: migration_20261110_152856_initial.down,
    name: '20261110_152856_initial',
  },
  {
    up: migration_20261110_165322_media_original_name_roles.up,
    down: migration_20261110_165322_media_original_name_roles.down,
    name: '20261110_165322_media_original_name_roles',
  },
  {
    up: migration_20261111_114409_ticket_filter_indexes.up,
    down: migration_20261111_114409_ticket_filter_indexes.down,
    name: '20261111_114409_ticket_filter_indexes'
  },
];
