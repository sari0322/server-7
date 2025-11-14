import { Hono } from 'jsr:@hono/hono';
import { serveStatic } from 'jsr:@hono/hono/deno';
const app = new Hono();

app.use('/*', serveStatic({ root: './public' }));

// データベースの準備
let kv;
if (typeof Deno.openKv === 'function') {
  try {
    kv = await Deno.openKv();
  } catch (e) {
    console.warn('Deno.openKv() 呼び出しに失敗しました。メモリフォールバックを使用します。', e);
  }
}

if (!kv) {
  console.warn('KV API が利用できないため、インメモリの Map を代替として使用します（永続化されません）。');
  const store = new Map();

  kv = {
    async get(key) {
      const k = JSON.stringify(key);
      if (store.has(k)) return { value: store.get(k) };
      return { value: undefined };
    },
    async set(key, value) {
      const k = JSON.stringify(key);
      store.set(k, value);
    },
    async delete(key) {
      const k = JSON.stringify(key);
      store.delete(k);
    },
    list({ prefix } = {}) {
      async function* gen() {
        for (const [k, v] of store.entries()) {
          try {
            const parsed = JSON.parse(k);
            if (!prefix || JSON.stringify(parsed.slice(0, prefix.length)) === JSON.stringify(prefix)) {
              yield { value: v };
            }
          } catch (_e) {
            // ignore malformed keys
          }
        }
      }
      return gen();
    }
  };
}

async function getNextId() {
  let max = 0;
  const iter = await kv.list({ prefix: ['pokemons'] });
  for await (const item of iter) {
    if (item.value && typeof item.value.id === 'number') {
      if (item.value.id > max) max = item.value.id;
    }
  }
  return max + 1;
}

/***  リソースの作成 ***/
app.post('/api/pokemons', async (c) => {
  const body = await c.req.parseBody();
  const record = JSON.parse(body.record);

  const id = await getNextId();
  record.id = id;
  record.createAt = new Date().toISOString();

  await kv.set(['pokemons', id], record);
  c.status(201);
  c.header('Location', `/api/pokemons/${id}`);

  return c.json({ record });
});

/*** リソースの取得（レコード単体） ***/
app.get('/api/pokemons/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const pkmn = await kv.get(['pokemons', id]);
  if (pkmn.value) {
    return c.json(pkmn.value);
  } else {
    c.status(404);
    return c.json({ message: `IDが${id}のポケモンはいませんでした。` });
  }
});

/*** リソースの取得（コレクション） ***/
app.get('/api/pokemons', async (c) => {
  const pkmns = await kv.list({ prefix: ['pokemons'] });
  const pkmnList = [];
  for await (const item of pkmns) {
    pkmnList.push(item);
  }
  if (pkmnList.length > 0) {
    return c.json(pkmnList.map((e) => e.value));
  } else {
    c.status(404);
    return c.json({ message: 'pokemonコレクションのデータは1つもありませんでした。' });
  }
});

/*** リソースの更新 ***/
app.put('/api/pokemons/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (isNaN(id) || !Number.isInteger(id)) {
    c.status(400);
    return c.json({ message: '更新したいポケモンのIDを正しく指定してください。' });
  }

  const pkmns = await kv.list({ prefix: ['pokemons'] });
  let existed = false;
  for await (const pkmn of pkmns) {
    if (pkmn.value.id == id) {
      existed = true;
      break;
    }
  }
  if (existed) {
    const body = await c.req.parseBody();
    const record = JSON.parse(body['record']);
    await kv.set(['pokemons', id], record);

    c.status(204);
    return c.body(null);
  } else {
    c.status(404); // 404 Not Found
    return c.json({ message: `IDが ${id} のポケモンはいませんでした。` });
  }
});

/*** リソースの削除 ***/
app.delete('/api/pokemons/:id', async (c) => {
  const id = Number(c.req.param('id'));

  const pkmns = await kv.list({ prefix: ['pokemons'] });
  let existed = false;
  for await (const pkmn of pkmns) {
    if (pkmn.value.id == id) {
      existed = true;
      break;
    }
  }

  if (existed) {
    await kv.delete(['pokemons', id]);
    c.status(204);
    return c.body(null);
  } else {
    c.status(404);
    return c.json({ message: `IDが ${id} のポケモンはいませんでした。` });
  }
});

/*** リソースをすべて削除（練習用） ***/
app.delete('/api/pokemons', async (c) => {
  return c.json({ path: c.req.path });
});

Deno.serve(app.fetch);
