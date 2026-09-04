import { getDatabase } from '@netlify/database';

export function database() { return getDatabase(); }
export async function rows(sql, params = []) { const result = await database().pool.query(sql, params); return result.rows; }

export async function audited({ actor, action, entityType, entityId, before = null, after = null, requestId }, operation) {
  const client = await database().pool.connect();
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('INSERT INTO audit_log(actor_email,actor_role,action,entity_type,entity_id,before_data,after_data,request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [actor.email, actor.role, action, entityType, String(entityId), before, after || result, requestId]);
    await client.query('COMMIT');
    return result;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
