// src/utils/logger.js
import chalk from 'chalk';

/**
 * Custom Drizzle logger for debugging SQL queries
 */
export const drizzleLogger = {
  logQuery(query, params) {
    const time = new Date().toISOString();

    console.log(chalk.gray(`\n[${time}]`));
    console.log(chalk.cyan.bold('🧩 SQL QUERY:'));
    console.log(chalk.white(query));

    if (params && params.length) {
      console.log(chalk.yellow('🔸 Params:'), params);
    }

    console.log(chalk.green('───────────────────────────────────────────────'));
  },
};
