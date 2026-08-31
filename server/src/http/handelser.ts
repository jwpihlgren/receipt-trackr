import type { FastifyInstance } from "fastify";
import type { Handelser } from "../handelser.js";

/** Hjärtslag var tjugofemte sekund. Under en minut, för mellanlagrare som stänger tysta strömmar. */
const PULS_MS = 25_000;

/**
 * Strömmen klienterna lyssnar på: `GET /api/handelser`, som `text/event-stream`.
 *
 * SSE och inte websocket, av tre skäl. Trafiken går åt ett håll — servern säger vad som
 * ändrats, klienten frågar sedan själv. Webbläsaren återansluter av sig själv när nätet
 * tappar, vilket är precis vad en telefon i en butik behöver. Och det kräver inget
 * bibliotek på någondera sidan.
 *
 * Svaret hijackas ur Fastify: livslängden är hela uppkopplingen, inte ett anrop, och
 * ramverkets svarshantering hör till det senare.
 */
export function registerHandelser(app: FastifyInstance, handelser: Handelser): void {
  app.get("/api/handelser", (request, reply) => {
    reply.hijack();
    const svar = reply.raw;

    svar.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
      // Mellanlagrare som buffrar svaret gör strömmen värdelös utan att något syns.
      "x-accel-buffering": "no",
    });
    // Ett första byte, så att webbläsaren öppnar strömmen i stället för att vänta på
    // att svaret ska börja.
    svar.write(": ansluten\n\n");

    const sluta = handelser.lyssna((h) => {
      svar.write(`data: ${JSON.stringify(h)}\n\n`);
    });

    const puls = setInterval(() => svar.write(": puls\n\n"), PULS_MS);
    // `unref` så att en öppen ström inte håller processen vid liv vid nedstängning.
    puls.unref?.();

    /**
     * Städningen sitter på tre händelser, inte en. `close` på requesten täcker den
     * normala fliken som stängs; `close` och `error` på svaret täcker en uppkoppling
     * som dör i andra änden. Utan alla tre låg lyssnaren och timern kvar och skrev
     * till en död ström vid varje skrivning i arkivet.
     */
    const stang = (): void => {
      clearInterval(puls);
      sluta();
    };
    request.raw.on("close", stang);
    svar.on("close", stang);
    svar.on("error", stang);
  });
}
