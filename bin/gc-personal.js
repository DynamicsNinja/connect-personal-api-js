#!/usr/bin/env node
// Copyright 2026 Garmin Ltd. or its subsidiaries.
// Ported to JavaScript from garmin/connect-personal-api-python.
// Licensed under the Apache License, Version 2.0; see the LICENSE file.

import { main } from '../src/cli.js';

process.exitCode = await main(process.argv.slice(2));
