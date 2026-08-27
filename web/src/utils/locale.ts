const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})/;

export function formatDatePtBR(value?: string | null): string {
  if (!value) return '';
  const match = value.match(ISO_DATE_PATTERN);
  if (!match) return value;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export function formatTimePtBR(value?: string | null): string {
  if (!value) return '';
  const match = value.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return value;
  return `${match[1].padStart(2, '0')}:${match[2]}`;
}

export function formatScheduleDateTimePtBR(date?: string | null, time?: string | null): string {
  const formattedDate = formatDatePtBR(date);
  const formattedTime = formatTimePtBR(time);
  if (!formattedTime) return formattedDate;
  return `${formattedDate} às ${formattedTime}`;
}

export function formatTimestampPtBR(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}
