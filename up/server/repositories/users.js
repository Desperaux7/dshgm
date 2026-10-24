const COLUNAS = 'id, google_sub, email, email_verified, name, picture_url, timezone'

export function criarRepoUsuarios(db) {
  return {
    async upsertGoogle({ sub, email, emailVerificado, nome, foto }, fusoPadrao) {
      const [u] = await db.query(
        `insert into users (google_sub, email, email_verified, name, picture_url, timezone)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (google_sub) do update
           set email = excluded.email, email_verified = excluded.email_verified,
               name = excluded.name, picture_url = excluded.picture_url, last_login_at = now()
         returning ${COLUNAS}`,
        [sub, email, Boolean(emailVerificado), nome ?? '', foto ?? null, fusoPadrao]
      )
      return u
    },
    async porId(id) {
      const [u] = await db.query(`select ${COLUNAS} from users where id = $1`, [id])
      return u ?? null
    },
    async registrarImportacao(userId, resumo) {
      await db.query('insert into import_runs (user_id, summary) values ($1, $2::jsonb)', [userId, JSON.stringify(resumo)])
    },
    async definirFuso(id, fuso) {
      await db.query('update users set timezone = $2 where id = $1', [id, fuso])
    }
  }
}
