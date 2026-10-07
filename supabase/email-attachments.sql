-- Allow the document attachments supported by the email composers.
-- Run on existing installs; preserves custom types, unrestricted buckets,
-- upload limits, public visibility, objects and storage policies.
begin;
update storage.buckets
set allowed_mime_types = array(
  select distinct mime
  from unnest(allowed_mime_types || array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ]::text[]) as accepted(mime)
  order by mime
)
where id = 'survey-uploads' and allowed_mime_types is not null;
commit;
