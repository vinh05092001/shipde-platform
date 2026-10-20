// Fixtures for shipde-no-dangerous-html.
declare const html: string;
// ruleid: shipde-no-dangerous-html
export const Bad = () => <div dangerouslySetInnerHTML={{ __html: html }} />;
// ok: shipde-no-dangerous-html
export const Good = () => <div>{html}</div>;
