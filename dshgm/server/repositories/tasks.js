import { atualizarCampos } from './sql.js'

const SELECT = `
  select t.id, t.text as texto, t.kind as tipo, to_char(t.date, 'YYYY-MM-DD') as data,
         t.weekdays as dias, to_char(t.created_on, 'YYYY-MM-DD') as criada,
         coalesce((select jsonb_object_agg(to_char(c.day, 'YYYY-MM-DD'), true)
                     from task_completions c where c.task_id = t.id), '{}'::jsonb) as concluidas,
         coalesce((select jsonb_object_agg(to_char(p.day, 'YYYY-MM-DD'), true)
                     from task_progress p where p.task_id = t.id), '{}'::jsonb) as andamento,
         coalesce((select jsonb_agg(jsonb_build_object(
                          'id', i.id,
                          'texto', i.text,
                          'feitos', coalesce((select jsonb_object_agg(to_char(d.day, 'YYYY-MM-DD'), true)
                                                from task_checklist_done d where d.item_id = i.id), '{}'::jsonb))
                        order by i.position, i.created_at, i.id)
                     from task_checklist_items i where i.task_id = t.id), '[]'::jsonb) as checklist
    from tasks t`

const mapear = (r) => ({
  id: r.id,
  texto: r.texto,
  tipo: r.tipo,
  data: r.data,
  dias: (r.dias ?? []).map(Number),
  criada: r.criada,
  concluidas: r.concluidas ?? {},
  andamento: r.andamento ?? {},
  checklist: r.checklist ?? []
})

export function criarRepoTarefas(db) {
  return {
    async listar(userId, limite = 2000) {
      const linhas = await db.query(`${SELECT} where t.user_id = $1 order by t.created_at, t.id limit $2`, [userId, limite])
      return linhas.map(mapear)
    },
    async obter(userId, id) {
      const [r] = await db.query(`${SELECT} where t.user_id = $1 and t.id = $2`, [userId, id])
      return r ? mapear(r) : null
    },
    async criar(userId, t) {
      const [{ id }] = await db.query(
        `insert into tasks (user_id, text, kind, date, weekdays, created_on)
         values ($1, $2, $3, $4::date, $5::int[], $6::date) returning id`,
        [userId, t.texto, t.tipo, t.data ?? null, t.dias, t.criada]
      )
      return this.obter(userId, id)
    },
    async atualizar(userId, id, campos) {
      const mapa = {}
      if ('texto' in campos) mapa.text = [campos.texto]
      if ('tipo' in campos) mapa.kind = [campos.tipo]
      if ('data' in campos) mapa.date = [campos.data, 'date']
      if ('dias' in campos) mapa.weekdays = [campos.dias, 'int[]']
      if ('criada' in campos) mapa.created_on = [campos.criada, 'date']
      const ok = await atualizarCampos(db, 'tasks', userId, id, mapa)
      return ok ? this.obter(userId, id) : null
    },
    // Substitui a checklist da tarefa pela lista recebida, em uma única instrução:
    //   - item com id da própria tarefa: mantém (texto e posição atualizados, marcações preservadas);
    //   - item sem id: criado;  - item que não veio na lista: removido (com as marcações dele).
    // O EXISTS impede qualquer escrita em tarefa de outro usuário; um id que não é desta tarefa é ignorado.
    async definirChecklist(userId, id, itens) {
      const entrada = itens.map((item, indice) => ({ id: item.id ?? null, texto: item.texto, pos: indice }))
      const [r] = await db.query(
        `with dono as (select 1 from tasks where id = $1 and user_id = $2),
              entrada as (select * from jsonb_to_recordset($3::jsonb) as t(id uuid, texto text, pos int)),
              apagados as (
                delete from task_checklist_items i
                 where i.task_id = $1 and exists (select 1 from dono)
                   and not exists (select 1 from entrada e where e.id = i.id)
                 returning 1),
              atualizados as (
                update task_checklist_items i set text = e.texto, position = e.pos
                  from entrada e
                 where i.id = e.id and i.task_id = $1 and exists (select 1 from dono)
                 returning i.id),
              novos as (
                insert into task_checklist_items (task_id, text, position)
                select $1, e.texto, e.pos from entrada e where e.id is null and exists (select 1 from dono)
                returning id)
         select exists (select 1 from dono) as ok`,
        [id, userId, JSON.stringify(entrada)]
      )
      return Boolean(r?.ok)
    },
    // Marca/desmarca um item da checklist em um dia. Só grava se o item for de uma tarefa do usuário.
    async definirItemChecklist(userId, id, itemId, dia, feito) {
      const [r] = await db.query(
        `with dono as (
                select 1 from task_checklist_items i join tasks t on t.id = i.task_id
                 where i.id = $1 and i.task_id = $2 and t.user_id = $3),
              sai as (
                delete from task_checklist_done
                 where item_id = $1 and day = $4::date and not $5::boolean and exists (select 1 from dono)
                 returning 1),
              entra as (
                insert into task_checklist_done (item_id, day)
                select $1, $4::date where $5::boolean and exists (select 1 from dono)
                on conflict do nothing returning 1)
         select exists (select 1 from dono) as ok`,
        [itemId, id, userId, dia, feito]
      )
      return Boolean(r?.ok)
    },
    async excluir(userId, id) {
      const r = await db.query('delete from tasks where id = $1 and user_id = $2 returning id', [id, userId])
      return r.length > 0
    },
    // Estado de um dia da tarefa: 'pendente' | 'andamento' | 'concluida'. Os três são exclusivos e a troca é
    // uma única instrução (as CTEs enxergam o mesmo instante), então o dia nunca fica em dois estados.
    // Só grava se a tarefa pertencer ao usuário (o EXISTS impede escrita em tarefa alheia).
    async definirStatus(userId, id, dia, status) {
      const [r] = await db.query(
        `with dono as (select 1 from tasks where id = $1 and user_id = $2),
              sai_concluida as (
                delete from task_completions
                 where task_id = $1 and day = $3::date and $4::text <> 'concluida' and exists (select 1 from dono)
                 returning 1),
              sai_andamento as (
                delete from task_progress
                 where task_id = $1 and day = $3::date and $4::text <> 'andamento' and exists (select 1 from dono)
                 returning 1),
              entra_concluida as (
                insert into task_completions (task_id, day)
                select $1, $3::date where $4::text = 'concluida' and exists (select 1 from dono)
                on conflict do nothing returning 1),
              entra_andamento as (
                insert into task_progress (task_id, day)
                select $1, $3::date where $4::text = 'andamento' and exists (select 1 from dono)
                on conflict do nothing returning 1)
         select exists (select 1 from dono) as ok`,
        [id, userId, dia, status]
      )
      return Boolean(r?.ok)
    },
    // Compatibilidade: marcar/desmarcar conclusão (desmarcar volta o dia para pendente).
    definirConclusao(userId, id, dia, concluida) {
      return this.definirStatus(userId, id, dia, concluida ? 'concluida' : 'pendente')
    },
    // Importação em lote, idempotente por (user_id, client_id), em uma única instrução.
    async importar(userId, lote) {
      if (!lote.length) return { recebidos: 0, importados: 0 }
      const [r] = await db.query(
        `with entrada as (
           select * from jsonb_to_recordset($2::jsonb)
             as t(client_id text, texto text, tipo text, data date, dias int[], criada date, concluidas jsonb)
         ),
         novas as (
           insert into tasks (user_id, client_id, text, kind, date, weekdays, created_on)
           select $1::uuid, client_id, texto, tipo, data, coalesce(dias, '{}'), criada from entrada
           on conflict (user_id, client_id) do nothing
           returning id, client_id
         ),
         conclusoes as (
           insert into task_completions (task_id, day)
           select novas.id, d::date
             from novas join entrada using (client_id), jsonb_array_elements_text(entrada.concluidas) as d
           on conflict do nothing
           returning 1
         )
         select (select count(*) from entrada)::int as recebidos, (select count(*) from novas)::int as importados`,
        [userId, JSON.stringify(lote)]
      )
      return r
    }
  }
}
