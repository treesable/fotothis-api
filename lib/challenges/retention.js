// Privacy retention (docs/CHALLENGES.md "Privacy and retention"): a challenge's data goes 30 days
// after it ends; a member who hasn't been in any challenge for 90 days goes too.
import { query } from "../db.js";

export const RETENTION = { endedChallengeDays: 30, idleMemberDays: 90 };

export async function runRetention(now = new Date()) {
  // Challenges past their end that nobody marked ended yet (no request came in) end now.
  await query("update challenges set status = 'ended' where status = 'active' and ends_at <= $1", [now]);
  // Waiting challenges nobody joined for 30 days are abandoned.
  const abandoned = await query(
    "delete from challenges where status = 'waiting' and created_at < $1::timestamptz - make_interval(days => $2)",
    [now, RETENTION.endedChallengeDays],
  );
  const ended = await query(
    "delete from challenges where status = 'ended' and ends_at < $1::timestamptz - make_interval(days => $2)",
    [now, RETENTION.endedChallengeDays],
  );
  // Idle: not seen for 90 days and in no challenge that's still kept.
  const idle = await query(
    `delete from members m
      where m.last_seen_at < $1::timestamptz - make_interval(days => $2)
        and not exists (select 1 from challenge_members cm where cm.member_id = m.id)`,
    [now, RETENTION.idleMemberDays],
  );
  return { challengesDeleted: abandoned.rowCount + ended.rowCount, membersDeleted: idle.rowCount };
}
