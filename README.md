This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Run the full app locally

Requires Postgres on `localhost:5433` and a `.env` with `DATABASE_URL` plus any
providers you want to use. Then:

```bash
npx prisma db migrate   # apply contract migrations
npm run demo            # web + writing, image, audio, render, multiformat, publishing
```

Open [http://localhost:3000](http://localhost:3000), register, create a project,
add a brief, and generate. The web process only enqueues jobs; the workers
consume them. `npm run demo` enables the interpretation seams by default; set
`CONTENT_OS_AI_INTERPRETATION=0` explicitly for deterministic-only behavior.
Ctrl+C stops every process group.

Text and image providers are optional for deterministic flows, and free or
community endpoints work: Groq, NVIDIA and OpenRouter for text; AI Horde and
Pollinations for images. Without a writing or image provider, those jobs fail
with an explicit unconfigured error rather than fabricating output.

For a web-only development server, run `npm run dev` and start the workers you
need (`npm run writing:worker`, `npm run image:worker`, etc.) in separate
terminals.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
