-- Add docx + pptx to the doc_kind enum so uploads of Word and PowerPoint
-- files can be parsed and saved as directory documents.

do $$ begin
  if not exists (
    select 1 from pg_enum
    where enumlabel = 'docx'
      and enumtypid = (select oid from pg_type where typname = 'doc_kind')
  ) then
    alter type doc_kind add value 'docx';
  end if;
  if not exists (
    select 1 from pg_enum
    where enumlabel = 'pptx'
      and enumtypid = (select oid from pg_type where typname = 'doc_kind')
  ) then
    alter type doc_kind add value 'pptx';
  end if;
end $$;
