import { db } from './database';

export default {
    get: async (key: string, maxAge: number, { rolling, ctx }: any) => {
        const cmd = `SELECT * FROM session WHERE session_id = $(key)`
        const record = await db.default.oneOrNone(cmd, { key });
        if (record) {
            const data = record.data || {};
            data.id = key;
            return data;
        } else {
            return null;
        }
    },
    set: async (key: string, sess: any, maxAge: number, { rolling, changed, ctx }: any) => {
        try {
            if (!changed) return;
            const cmd = `
WITH row AS (
    SELECT
        $(key)::TEXT AS session_id
        , $(data)::JSON AS data
), upd AS (
    UPDATE session SET
        expiry_date = FLOOR(EXTRACT(EPOCH FROM now()) * 1000) + $(maxAge)::INT
        , data = row.data
    FROM
        row
    WHERE
        session.session_id = row.session_id
), ins AS (
    INSERT INTO session(
        session_id
        , expiry_date
        , data
    )
    SELECT
        row.session_id
        , FLOOR(EXTRACT(EPOCH FROM now()) * 1000) + $(maxAge)::INT AS expiry_date
        , row.data
    FROM
        row
    WHERE
        NOT EXISTS (
            SELECT 
                session.*
            FROM
                row
                INNER JOIN session
                    ON session.session_id = row.session_id
        )
), auto_clean AS (
    DELETE FROM session 
    WHERE 
        expiry_date < FLOOR(EXTRACT(EPOCH FROM now()    - interval '5 minutes') * 1000)
)
SELECT 0`;
            await db.default.oneOrNone(cmd, { key, data: JSON.stringify(sess), maxAge });
        } catch (error: any) {
            const message = error instanceof Error ? error.message : String(error);
            console.error(`set session occure error: ${message}`);
        }
    },
    destroy: async (key: string) => {
        try {
            await db.default.none(`DELETE FROM session WHERE session_id = $(key)`, { key });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error(`set session occure error: ${message}`);
        }
    }
}