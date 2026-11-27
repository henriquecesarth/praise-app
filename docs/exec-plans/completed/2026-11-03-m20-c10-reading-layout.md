# M20-C10 — responsividade e espaçamento

Status: completed (implementação e validação locais; homologação remota pendente). 2026-11-03.

Objetivo: ajustar somente interface do modal PDF e adicionar preferência pessoal de leitura entre blocos 0–24px, passo 2, padrão 8px em Web/mobile. Documento PDF e parser preservados.

Base: branch feat/m20-phase-2a-android-share, HEAD 452a2558e9fbb16e509a99a682c368e329821d15; working tree C9B preservado. Sem push/deploy/ambiente.

Contrato: campo opcional chord_line_spacing_px, inteiro par 0..24, default8, atualização parcial preserva fonte. Reutilizar endpoint pessoal existente. Sincronização remota requer futuro Backend atualizado; nenhuma publicação autorizada.

Escritores: backend /root/backend_spacing; mobile /root/mobile_spacing; web /root/web_spacing; raiz e2e/docs/revisão integrada.

Validação: backend preferências e build; mobile widget/providers/analyze; Web unit/build, responsividade 360/390/768/1024/1366 e PDF real em diretório C10 separado. Revisão independente somente leitura após implementação.

Resultado: consultar [[exec-plans/evidence/m20-c10/REPORT|relatório e evidências C10]]. Sem publicação nesta tarefa.

