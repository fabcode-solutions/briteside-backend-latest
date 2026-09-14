import 'dotenv/config';
import { db } from '../src/db/index.js';
import { groups, groupMembers } from '../src/db/schema/index.js';
import { eq, sql } from 'drizzle-orm';

/**
 * Sync member counts for all groups
 * This script updates the memberCount field in the groups table
 * to match the actual number of members in groupMembers table
 */
async function syncGroupMemberCounts() {
  console.log('Starting group member count sync...');

  try {
    // Get all groups
    const allGroups = await db
      .select({ id: groups.id, name: groups.name, memberCount: groups.memberCount })
      .from(groups);

    console.log(`Found ${allGroups.length} groups to sync`);

    let updatedCount = 0;
    let skippedCount = 0;
    const discrepancies = [];

    for (const group of allGroups) {
      // Count actual members for this group
      const [result] = await db
        .select({ count: sql`count(*)::int` })
        .from(groupMembers)
        .where(eq(groupMembers.groupId, group.id));

      const actualMemberCount = result.count;
      const currentMemberCount = group.memberCount || 0;

      if (actualMemberCount !== currentMemberCount) {
        // Update the group's member count to actual count
        await db
          .update(groups)
          .set({ memberCount: actualMemberCount })
          .where(eq(groups.id, group.id));

        discrepancies.push({
          groupId: group.id,
          groupName: group.name,
          oldCount: currentMemberCount,
          newCount: actualMemberCount,
          difference: actualMemberCount - currentMemberCount,
        });

        updatedCount++;
        console.log(`✓ Updated "${group.name}": ${currentMemberCount} → ${actualMemberCount}`);
      } else {
        skippedCount++;
      }
    }

    console.log('\n=== Sync Complete ===');
    console.log(`Total groups: ${allGroups.length}`);
    console.log(`Updated: ${updatedCount}`);
    console.log(`Already correct: ${skippedCount}`);

    if (discrepancies.length > 0) {
      console.log('\n=== Discrepancies Found ===');
      discrepancies.forEach(d => {
        console.log(
          `  ${d.groupName} (${d.groupId}): ${d.oldCount} → ${d.newCount} (${d.difference > 0 ? '+' : ''}${d.difference})`
        );
      });
    }

    process.exit(0);
  } catch (error) {
    console.error('Error syncing group member counts:', error);
    process.exit(1);
  }
}

// Run the sync
syncGroupMemberCounts();
