/** Shared CSS for our system templates; Gmail may still transform neutral surfaces. */
export const systemEmailThemeHead = `
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<style>
:root { color-scheme: light dark; supported-color-schemes: light dark; }
u + .mavinci-email .gmail-blend-screen { background:#000; mix-blend-mode:screen; }
u + .mavinci-email .gmail-blend-difference { background:#000; mix-blend-mode:difference; }
.email-card { background-color:#ffffff; color:#292329; }
.email-content { color:#292329; }
.email-heading { color:#651b38 !important; }
.email-footer { color:#65555d !important; }
@media (prefers-color-scheme: dark) {
  .mavinci-email, .email-shell { background-color:#191619 !important; }
  .email-card, .email-content { background-color:#242024 !important; color:#f3edf0 !important; }
  .email-panel, .email-event, .email-footer { background-color:#302930 !important; border-color:#4a3d45 !important; }
  .email-content div, .email-content p, .email-content td, .email-content strong, .email-content a { color:#f3edf0 !important; border-color:#4a3d45 !important; }
  .email-content .email-label, .email-footer { color:#cdbfc6 !important; }
  .email-content .email-heading { color:#e3ce92 !important; }
  .email-content .email-cta { background-color:#d3bb73 !important; color:#250914 !important; }
}
[data-ogsc] .email-card, [data-ogsc] .email-content { background-color:#242024 !important; color:#f3edf0 !important; }
[data-ogsc] .email-panel, [data-ogsc] .email-event, [data-ogsc] .email-footer { background-color:#302930 !important; }
[data-ogsc] .email-content div, [data-ogsc] .email-content p, [data-ogsc] .email-content td, [data-ogsc] .email-content strong { color:#f3edf0 !important; }
[data-ogsc] .email-content .email-label, [data-ogsc] .email-footer { color:#cdbfc6 !important; }
[data-ogsc] .email-content .email-heading { color:#e3ce92 !important; }
</style>`;

/** Pass escaped text only. White is required by Gmail's blend-mode workaround. */
export const gmailWhiteText = (text: string) =>
  `<div class="gmail-blend-screen"><div class="gmail-blend-difference" style="color:#ffffff;">${text}</div></div>`;
