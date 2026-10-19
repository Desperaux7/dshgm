const COLUNAS = `user_id, google_email, calendar_id, refresh_token_enc, scopes, status, sync_token,
  to_char(last_sync_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as last_sync_at, last_error,
  extract(epoch from (now() - last_sync_at))::float as segundos_desde_sync`

export function criarRepoCalendario(db) {
  return {
    async obter(userId) {
      const [c] = await db.query(`select ${COLUNAS} from calendar_connections where user_id = $1`, [userId])
      return c ?? null
    },
    async conectar(userId, { email, refreshTokenCriptografado, escopos }) {
      // Nova conexão zera o cursor: a primeira sincronização é completa e reconcilia por ids determinísticos.
      await db.query(
        `insert into calendar_connections (user_id, google_email, refresh_token_enc, scopes, status, sync_token, last_error)
         values ($1, $2, $3, $4, 'connected', null, null)
         on conflict (user_id) do update
           set google_email = excluded.google_email, refresh_token_enc = excluded.refresh_token_enc,
               scopes = excluded.scopes, status = 'connected', sync_token = null, last_error = null,
               sync_lock_until = null, connected_at = now(), updated_at = now()`,
        [userId, email ?? null, refreshTokenCriptografado, escopos]
      )
    },
    async remover(userId) {
      await db.query('delete from calendar_connections where user_id = $1', [userId])
    },
    async definirStatus(userId, status, erro = null) {
      await db.query(
        'update calendar_connections set status = $2, last_error = $3, updated_at = now() where user_id = $1',
        [userId, status, erro ? String(erro).slice(0, 300) : null]
      )
    },
    // Trava otimista contra duas sincronizações simultâneas (agendador + usuário).
    async adquirirTrava(userId, segundos = 120) {
      const r = await db.query(
        `update calendar_connections set sync_lock_until = now() + make_interval(secs => $2::double precision)
          where user_id = $1 and (sync_lock_until is null or sync_lock_until < now()) returning user_id`,
        [userId, segundos]
      )
      return r.length > 0
    },
    async liberarTrava(userId) {
      await db.query('update calendar_connections set sync_lock_until = null where user_id = $1', [userId])
    },
    async registrarSync(userId, { syncToken, erro = null }) {
      await db.query(
        `update calendar_connections
            set sync_token = coalesce($2, sync_token), last_sync_at = now(), last_error = $3, updated_at = now()
          where user_id = $1`,
        [userId, syncToken ?? null, erro ? String(erro).slice(0, 300) : null]
      )
    },
    async limparSyncToken(userId) {
      await db.query('update calendar_connections set sync_token = null where user_id = $1', [userId])
    },
    async conectadosParaAgendador(limite = 25) {
      return db.query(
        `select c.user_id, u.timezone from calendar_connections c join users u on u.id = c.user_id
          where c.status = 'connected' order by c.last_sync_at nulls first limit $1`,
        [limite]
      )
    }
  }
}
