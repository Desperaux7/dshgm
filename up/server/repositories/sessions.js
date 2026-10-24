export function criarRepoSessoes(db) {
  return {
    async criar({ userId, idHash, csrf, ociosaSeg, absolutaSeg }) {
      await db.query(
        `insert into sessions (id_hash, user_id, csrf_token, expires_at, absolute_expires_at)
         values ($1, $2, $3, now() + make_interval(secs => $4::double precision), now() + make_interval(secs => $5::double precision))`,
        [idHash, userId, csrf, ociosaSeg, absolutaSeg]
      )
    },
    // Retorna a sessão (e o usuário) somente se ainda estiver dentro dos dois prazos.
    async buscar(idHash) {
      const [s] = await db.query(
        `select s.csrf_token, extract(epoch from (now() - s.last_seen_at))::float as ocioso_seg,
                u.id, u.google_sub, u.email, u.name, u.picture_url, u.timezone
           from sessions s join users u on u.id = s.user_id
          where s.id_hash = $1 and s.expires_at > now() and s.absolute_expires_at > now()`,
        [idHash]
      )
      return s ?? null
    },
    async renovar(idHash, ociosaSeg) {
      await db.query(
        `update sessions set last_seen_at = now(),
                expires_at = least(now() + make_interval(secs => $2::double precision), absolute_expires_at)
          where id_hash = $1`,
        [idHash, ociosaSeg]
      )
    },
    async remover(idHash) {
      await db.query('delete from sessions where id_hash = $1', [idHash])
    },
    async limparExpiradas() {
      await db.query('delete from sessions where expires_at <= now() or absolute_expires_at <= now()')
    }
  }
}
