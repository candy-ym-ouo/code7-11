import type { PoolClient } from "pg";
import { config } from "./config";
import { createNotification, queueOutbox } from "./audit";

export async function notifyUser(
  client: PoolClient,
  input: {
    userId: string;
    type: string;
    title: string;
    body: string;
    link?: string | null;
  }
): Promise<void> {
  await createNotification(client, input);
  const user = await client.query<{ email: string }>("SELECT email FROM users WHERE id = $1", [input.userId]);
  const email = user.rows[0]?.email;
  if (!email) return;
  const link = input.link ? `${config.APP_ORIGIN}${input.link}` : config.APP_ORIGIN;
  await queueOutbox(client, {
    eventType: "email.notification",
    aggregateType: "user",
    aggregateId: input.userId,
    payload: {
      to: email,
      subject: input.title,
      text: `${input.body}\n\n${link}`,
      html: `<p>${escapeHtml(input.body)}</p><p><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>`
    }
  });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
