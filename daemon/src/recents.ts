// Phase 14: recent-projects store. Thin queries over the recent_projects
// table (migration 005). Every task submission calls touchRecentProject so the
// header "Recent" section reflects real usage.
import type { FleetDb } from './db.js';

export interface RecentProject {
  absolutePath: string;
  name: string;
  firstUsedAt: string;
  lastUsedAt: string;
  submissionCount: number;
}

/** Insert (count=1) or, on repeat, bump submission_count + last_used_at. */
export function touchRecentProject(db: FleetDb, absolutePath: string, name: string): void {
  db.raw
    .prepare(
      `INSERT INTO recent_projects (absolute_path, name, submission_count)
       VALUES (?, ?, 1)
       ON CONFLICT(absolute_path) DO UPDATE SET
         name = excluded.name,
         last_used_at = CURRENT_TIMESTAMP,
         submission_count = recent_projects.submission_count + 1`,
    )
    .run(absolutePath, name);
}

export function listRecentProjects(db: FleetDb, limit = 20): RecentProject[] {
  const rows = db.raw
    .prepare(
      `SELECT absolute_path AS absolutePath, name,
              first_used_at AS firstUsedAt, last_used_at AS lastUsedAt,
              submission_count AS submissionCount
         FROM recent_projects
        ORDER BY last_used_at DESC
        LIMIT ?`,
    )
    .all(Math.max(1, Math.min(100, limit))) as RecentProject[];
  return rows;
}

export function deleteRecentProject(db: FleetDb, absolutePath: string): boolean {
  const info = db.raw
    .prepare('DELETE FROM recent_projects WHERE absolute_path = ?')
    .run(absolutePath);
  return info.changes > 0;
}
