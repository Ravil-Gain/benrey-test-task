// Runs in every test worker before any test file, so the Payload config (which reads the
// environment when it is imported) connects to the test database and nothing else.
import 'dotenv/config'

import { testDatabaseUrl } from './testDatabase'

process.env.DATABASE_URL = testDatabaseUrl(process.env)
