import FileManagementService from '../services/fileManagement.service.js';
import logger from '../config/logger.js';

/**
 * Clean up files marked for deletion (older than grace period)
 * Runs daily to remove files that have been marked for deletion for 30+ days
 */
export const cleanupDeletedFiles = async () => {
  try {
    logger.info('Starting cleanup of deleted files...');

    const results = await FileManagementService.cleanupDeletedFiles(30);

    logger.info('Deleted files cleanup completed', {
      deleted: results.deleted,
      failed: results.failed,
      total: results.total,
    });

    return results;
  } catch (error) {
    logger.error('Error during deleted files cleanup:', error);
    throw error;
  }
};

/**
 * Clean up orphaned entity file references
 * Removes references where entity no longer exists
 */
export const cleanupOrphanedReferences = async () => {
  try {
    logger.info('Starting cleanup of orphaned file references...');

    const results = await FileManagementService.cleanupOrphanedReferences();

    logger.info('Orphaned references cleanup completed', results);

    return results;
  } catch (error) {
    logger.error('Error during orphaned references cleanup:', error);
    throw error;
  }
};

/**
 * Manual trigger for file cleanup jobs
 * @param {string} action - Action type: 'files', 'references', 'all'
 * @param {number} gracePeriodDays - Days to wait before permanent deletion (default: 30)
 */
export const triggerFileCleanup = async (action = 'all', gracePeriodDays = 30) => {
  try {
    logger.info(`Manually triggering file cleanup: ${action}`);

    const results = {};

    if (action === 'files' || action === 'all') {
      results.files = await cleanupDeletedFiles();
    }

    if (action === 'references' || action === 'all') {
      results.references = await cleanupOrphanedReferences();
    }

    logger.info('File cleanup completed', results);

    return results;
  } catch (error) {
    logger.error('Error during file cleanup:', error);
    throw error;
  }
};

export default {
  cleanupDeletedFiles,
  cleanupOrphanedReferences,
  triggerFileCleanup,
};
