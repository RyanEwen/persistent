/** Professional, privacy-conscious invitation copy for an unregistered recipient. */

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character] ?? character)
}

/** Keep reminder titles out of email; the recipient sees them after verification. */
export function buildShareInvitationEmail(input: { ownerName: string; email: string; appUrl: string }) {
  return buildInvitationEmail(input, 'shared')
}

/** Assignment invitations use the same private, accessible layout as sharing. */
export function buildAssignmentInvitationEmail(input: { ownerName: string; email: string; appUrl: string }) {
  return buildInvitationEmail(input, 'assigned')
}

function buildInvitationEmail(
  input: { ownerName: string; email: string; appUrl: string },
  kind: 'shared' | 'assigned'
) {
  const ownerName = escapeHtml(input.ownerName)
  const appUrl = escapeHtml(input.appUrl)
  const action = kind === 'assigned' ? 'created a reminder for you' : 'invited you to a shared reminder'

  return {
    subject: `${input.ownerName} ${action} on Persistent`,
    text: `${input.ownerName} ${action} on Persistent.\n\nSign up with ${input.email} to see it: ${input.appUrl}\n\nIf you were not expecting this invitation, you can ignore this email.`,
    html: `<!doctype html>
<html><body style="margin:0;padding:32px 16px;background:#f5f7fa;font-family:Arial,sans-serif;color:#172033">
  <table role="presentation" style="max-width:560px;width:100%;margin:auto;background:#fff;border:1px solid #e2e7ee;border-radius:12px">
    <tr><td style="padding:32px">
      <p style="margin:0 0 24px;color:#087f68;font-size:15px;font-weight:700">Persistent</p>
      <h1 style="margin:0 0 16px;font-size:25px;line-height:1.3">${kind === 'assigned' ? 'A reminder has been created for you' : 'You have been invited to a reminder'}</h1>
      <p style="margin:0 0 18px;line-height:1.6">${ownerName} ${action} on Persistent.</p>
      <p style="margin:0 0 28px;line-height:1.6">Create your free Persistent account with this email address to see it.</p>
      <a href="${appUrl}" style="display:inline-block;padding:13px 22px;background:#087f68;border-radius:7px;color:#fff;text-decoration:none;font-weight:700">Open Persistent</a>
      <p style="margin:28px 0 0;color:#647082;font-size:13px;line-height:1.5">If you were not expecting this invitation, you can ignore this email.</p>
    </td></tr>
  </table>
</body></html>`
  }
}
