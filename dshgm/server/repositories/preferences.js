export function criarRepoPreferencias(db) {
  return {
    async obter(userId) {
      const [p] = await db.query('select data, photo from preferences where user_id = $1', [userId])
      return p ?? null
    },
    // `foto`: undefined = manter, null = remover, string = substituir.
    async salvar(userId, dados, foto) {
      const [p] = await db.query(
        `insert into preferences (user_id, data, photo) values ($1, $2::jsonb, $3)
         on conflict (user_id) do update
           set data = excluded.data,
               photo = case when $4::boolean then excluded.photo else preferences.photo end,
               updated_at = now()
         returning data, photo`,
        [userId, JSON.stringify(dados), foto === undefined ? null : foto, foto !== undefined]
      )
      return p
    }
  }
}
