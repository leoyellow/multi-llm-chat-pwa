const express = require('express')
const https = require('https')
const path = require('path')
const app = express()

app.use(express.json({ limit: '1mb' }))
app.use(express.static(path.join(__dirname, 'public')))

const ALLOWED_HOSTS = {
  anthropic: 'api.anthropic.com',
  openai:    'api.openai.com',
  google:    'generativelanguage.googleapis.com',
  groq:      'api.groq.com',
  xai:       'api.x.ai',
  mistral:   'api.mistral.ai'
}

function securePost(hostname, urlPath, headers, body) {
  const allowed = Object.values(ALLOWED_HOSTS)
  if (!allowed.includes(hostname)) {
    return Promise.reject(new Error(`Host no permitido: ${hostname}`))
  }
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname, path: urlPath, method: 'POST', headers }, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        try { resolve(JSON.parse(data)) }
        catch (e) { reject(new Error('Respuesta invalida')) }
      })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

async function callOpenAICompat(hostname, urlPath, apiKey, model, system, messages, extra = {}) {
  const body = JSON.stringify({
    model, max_tokens: 1024,
    messages: [{ role: 'system', content: system }, ...messages],
    ...extra
  })
  const data = await securePost(hostname, urlPath, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Authorization': `Bearer ${apiKey}`
  }, body)
  if (data.error) throw new Error(JSON.stringify(data.error))
  if (!data.choices) throw new Error(`Respuesta inesperada: ${JSON.stringify(data)}`)
  return data.choices?.[0]?.message?.content || ''
}

app.post('/api/chat', async (req, res) => {
  const { model, messages, system, keys } = req.body

  if (!model || !messages || !system || !keys) {
    return res.status(400).json({ error: 'Faltan parametros' })
  }

  try {
    let reply = ''

    if (model === 'claude') {
      if (!keys.anthropic) throw new Error('Falta API key de Anthropic')
      const body = JSON.stringify({ model: 'claude-opus-4-5', max_tokens: 1024, system, messages })
      const data = await securePost('api.anthropic.com', '/v1/messages', {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'x-api-key': keys.anthropic,
        'anthropic-version': '2023-06-01'
      }, body)
      if (data.error) throw new Error(data.error.message)
      reply = data.content?.[0]?.text || ''
    }
    else if (model === 'gpt') {
      if (!keys.openai) throw new Error('Falta API key de OpenAI')
      reply = await callOpenAICompat('api.openai.com', '/v1/chat/completions', keys.openai, 'gpt-4o', system, messages)
    }
    else if (model === 'gemini') {
      if (!keys.google) throw new Error('Falta API key de Google')
      const contents = messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }))
      const body = JSON.stringify({ system_instruction: { parts: [{ text: system }] }, contents })
      const data = await securePost('generativelanguage.googleapis.com',
        `/v1beta/models/gemini-1.5-flash:generateContent?key=${keys.google}`,
        { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, body)
      if (data.error) throw new Error(data.error.message)
      reply = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
    }
    else if (model === 'grok') {
      if (!keys.xai) throw new Error('Falta API key de xAI')
      reply = await callOpenAICompat('api.x.ai', '/v1/chat/completions', keys.xai, 'grok-3-mini', system, messages)
    }
    else if (model === 'llama') {
      if (!keys.groq) throw new Error('Falta API key de Groq')
      reply = await callOpenAICompat('api.groq.com', '/openai/v1/chat/completions', keys.groq, 'llama-3.3-70b-versatile', system, messages)
    }
    else if (model === 'llama8b') {
      if (!keys.groq) throw new Error('Falta API key de Groq')
      reply = await callOpenAICompat('api.groq.com', '/openai/v1/chat/completions', keys.groq, 'llama-3.1-8b-instant', system, messages)
    }
    else if (model === 'qwen') {
      if (!keys.groq) throw new Error('Falta API key de Groq')
      reply = await callOpenAICompat('api.groq.com', '/openai/v1/chat/completions', keys.groq, 'qwen/qwen3-32b', system, messages, { reasoning_effort: 'none' })
    }
    else if (model === 'mistral') {
      if (!keys.mistral) throw new Error('Falta API key de Mistral')
      reply = await callOpenAICompat('api.mistral.ai', '/v1/chat/completions', keys.mistral, 'mistral-small-latest', system, messages)
    }
    else {
      throw new Error(`Modelo desconocido: ${model}`)
    }

    reply = reply.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
    res.json({ reply })

  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')))

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`))
