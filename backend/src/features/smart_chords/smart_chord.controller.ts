import { Request, Response, NextFunction } from 'express';
import pdfParse from 'pdf-parse';
import * as cheerio from 'cheerio';
import axios from 'axios';
import * as smartChordService from './smart_chord.service';
import {
  createSmartChordSchema,
  updateSmartChordSchema,
  smartChordsQuerySchema,
} from './smart_chord.types';

// Polyfill DOMMatrix for PDF parsing in Node environment
if (typeof (global as any).DOMMatrix === 'undefined') {
  (global as any).DOMMatrix = class DOMMatrix {};
}

// Helper to extract x-user-id header with a fallback dev user
function getUserId(req: Request): string {
  const userId = req.headers['x-user-id'];
  if (!userId) {
    // Default development user fallback
    return 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22';
  }
  return String(userId);
}

export async function listSmartChords(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = getUserId(req);
    const query = smartChordsQuerySchema.parse(req.query);

    const result = await smartChordService.getSmartChords(userId, {
      search: query.search,
      page: query.page ? parseInt(query.page) : undefined,
      limit: query.limit ? parseInt(query.limit) : undefined,
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function getSmartChord(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = getUserId(req);
    const { id } = req.params;

    const result = await smartChordService.getSmartChordById(id, userId);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function createSmartChord(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = getUserId(req);
    const body = createSmartChordSchema.parse(req.body);

    const result = await smartChordService.createSmartChord(userId, body);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

export async function updateSmartChord(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = getUserId(req);
    const { id } = req.params;
    const body = updateSmartChordSchema.parse(req.body);

    const result = await smartChordService.updateSmartChord(id, userId, body);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function deleteSmartChord(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = getUserId(req);
    const { id } = req.params;

    await smartChordService.deleteSmartChord(id, userId);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
}

export async function importSmartChord(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { type, fileBase64, url } = req.body;
    let rawText = '';

    if (type === 'pdf') {
      if (!fileBase64) {
        res.status(400).json({ error: { message: 'fileBase64 é obrigatório para importação de PDF.' } });
        return;
      }
      const buffer = Buffer.from(fileBase64, 'base64');
      const parsedPdf = await pdfParse(buffer);
      rawText = parsedPdf.text;
    } else if (type === 'url') {
      if (!url) {
        res.status(400).json({ error: { message: 'url é obrigatório para importação de links.' } });
        return;
      }
      
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });
      const html = response.data;
      const $ = cheerio.load(html);
      
      // Clean up scripts, styles, heads, footers, headers
      $('script, style, iframe, nav, footer, header, noscript').remove();
      
      // If it's a known site like Cifra Club, let's try to extract from the pre/cifra block to focus on the text content
      let extractedText = '';
      if (url.includes('cifraclub.com')) {
        extractedText = $('pre').text() || $('div.cifra-body').text() || $('div.cifra').text();
      }
      
      if (!extractedText) {
        // Fallback to body text
        extractedText = $('body').text();
      }

      // Clean excessive empty lines
      rawText = extractedText.replace(/\n\s*\n/g, '\n\n').trim();
    } else {
      res.status(400).json({ error: { message: 'Tipo de importação inválido. Deve ser "pdf" ou "url".' } });
      return;
    }

    if (!rawText) {
      res.status(400).json({ error: { message: 'Não foi possível extrair nenhum texto da fonte fornecida.' } });
      return;
    }

    const geminiApiKey = process.env.GEMINI_API_KEY;
    if (!geminiApiKey) {
      res.status(500).json({ error: { message: 'Chave da API do Gemini não configurada no servidor backend.' } });
      return;
    }

    const geminiUrl = `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash-lite:generateContent?key=${geminiApiKey}`;
    
    const promptText = `
Você é um assistente especialista em música, cifras e harmonias.
Sua tarefa é extrair e formatar a cifra de uma música fornecida no formato "Smart Chords".

Instruções importantes de formatação:
1. Os acordes devem ser inseridos exatamente na sílaba correspondente onde devem ser tocados, entre colchetes.
   Exemplo:
   Cifra Bruta:
     C           G
     Eu gosto de cantar
   Saída formatada:
     [C]Eu gosto de [G]cantar

2. Mantenha toda a estrutura de estrofes, refrão e quebras de linha limpas.
3. Se a cifra bruta tiver títulos de seções como [Refrão], [Estrofe 1], altere-os ou mantenha sem os colchetes para não confundir com acordes, ou remova os colchetes deles (ex: usar "Refrão:" ou "(Refrão)").
4. Identifique o Título da música, o Nome do Artista (se disponível) e o Tom Original (ex: C, G, Am, F#m).
5. Retorne a resposta em formato JSON estrito, contendo exatamente os seguintes campos:
{
  "title": "Título da música",
  "artist": "Nome do artista (ou vazio se não identificado)",
  "key": "Tom original identificado (ex: C, Dm, G, A)",
  "content": "A cifra formatada completa no padrão de colchetes inline"
}

Não adicione blocos de código Markdown (como \`\`\`json) na sua resposta, retorne APENAS o JSON puro.

Aqui está o texto bruto da cifra:
\${rawText}
`;

    const geminiResponse = await axios.post(
      geminiUrl,
      {
        contents: [
          {
            parts: [
              {
                text: promptText
              }
            ]
          }
        ]
      },
      {
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );

    const resultText = geminiResponse.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!resultText) {
      throw new Error('Resposta vazia da API do Gemini.');
    }

    let cleanJsonText = resultText.trim();
    // Remove potential markdown block wraps
    if (cleanJsonText.startsWith('```')) {
      cleanJsonText = cleanJsonText.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
    }

    const parsedResult = JSON.parse(cleanJsonText);
    res.json(parsedResult);
  } catch (error: any) {
    if (error.isAxiosError && error.response) {
      console.error('Gemini API Error Response:', JSON.stringify(error.response.data, null, 2));
      const errMsg = error.response.data?.error?.message || error.message;
      res.status(error.response.status).json({
        error: {
          message: `Erro na API do Gemini: ${errMsg}`,
          details: error.response.data
        }
      });
      return;
    }
    next(error);
  }
}
