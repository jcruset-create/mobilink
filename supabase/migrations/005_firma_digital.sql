-- ============================================================
-- Firma digital de documentos Safety — políticas anon para el portal
-- Ejecutar en Supabase > SQL Editor
-- ============================================================

-- Documentos Safety: el portal puede leer los publicados
CREATE POLICY "portal_anon_docs_read"
  ON sm_safety_documents FOR SELECT TO anon
  USING (publicado = true);

-- Acknowledgements: el portal puede leer, insertar y actualizar
CREATE POLICY "portal_anon_acks_select"
  ON sm_document_acknowledgements FOR SELECT TO anon
  USING (true);

CREATE POLICY "portal_anon_acks_insert"
  ON sm_document_acknowledgements FOR INSERT TO anon
  WITH CHECK (true);

CREATE POLICY "portal_anon_acks_update"
  ON sm_document_acknowledgements FOR UPDATE TO anon
  USING (true) WITH CHECK (true);
