import { fetchCifraClubHtml } from './cifraclub_http';
import { projectCifraClubHtml } from './cifraclub_html_projection';
import { parseCifraClubHtml, CifraClubHtmlResult } from './cifraclub_html_parser';

/** Experimental entry point; deliberately not wired to the production URL route. */
export async function importCifraClubDirect(url: string): Promise<CifraClubHtmlResult> {
  const html = await fetchCifraClubHtml(url);
  return parseCifraClubHtml(projectCifraClubHtml(html, url), url);
}
