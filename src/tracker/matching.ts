import { atsBoard, hostname, onSite } from "../shared/sites.ts";

const SHARED_HOSTS = ["smartrecruiters.com", "workable.com", "rippling.com", "jobvite.com", "lever.co", "dover.com",
  "wellfound.com", "linkedin.com"];
const MIN_COMPANY_LETTERS = 3;

export function letters(text: string): string {
  return text.toLowerCase().replace(/[^a-z]/g, "");
}

export function namesCompany(url: string, company: string): boolean {
  const companyLetters = letters(company);
  return companyLetters.length >= MIN_COMPANY_LETTERS && letters(url).includes(companyLetters);
}

export function applicationSite(url: string): string | null {
  const board = atsBoard(url);
  if (board) {
    const [ats, name] = board;
    return name ? `${ats}/${name}` : null;
  }

  if (onSite(url, SHARED_HOSTS)) {
    return null;
  }
  return hostname(url).replace(/^www\./, "") || null;
}
