import { sql } from "./db.js";

export async function canAccessProject(
  userId: string,
  projectId: string,
): Promise<boolean> {
  const result = await sql(
    `select 1
     from projects p
     left join collaborators c
       on c.project_id = p.id
      and c.user_id = $1
     where p.id = $2
       and (p.owner_id = $1 or c.user_id is not null)
     limit 1`,
    [userId, projectId],
  );

  return result.rowCount === 1;
}

export async function assertProjectAccess(
  userId: string,
  projectId: string,
): Promise<void> {
  if (!(await canAccessProject(userId, projectId))) {
    const error = new Error("Project not found or access denied");
    Object.assign(error, {
      statusCode: 403,
    });
    throw error;
  }
}

export async function assertProjectOwner(
  userId: string,
  projectId: string,
): Promise<void> {
  const result = await sql(
    `select 1
     from projects
     where id = $1
       and owner_id = $2`,
    [projectId, userId],
  );

  if (result.rowCount !== 1) {
    const error = new Error("Project owner access required");
    Object.assign(error, {
      statusCode: 403,
    });
    throw error;
  }
}
