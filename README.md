# Santa’s Secret Mission

A Christmas social deduction game from the Johns Hopkins African Students Association. Players receive private assignments, track their progress, and try to identify other agents’ missions. Staff review accusations in Mission Control, and the projector presents eliminations and the final winners.

| Route | Who uses it | Access |
| --- | --- | --- |
| `/` | Players | Register with a name and choose a four-digit game PIN |
| `/staff` | Organizers | Staff passphrase |
| `/screen` | Projector operator | Separate projector passphrase |

Share the player URL as a link or QR code. Organizers can open **Staff access** or **Projector** from the welcome page footer and enter their respective passphrases. Typing `jhu asa 2026` or `jhu asa presentation screen` in the name field opens the same sign-in screens. The projector’s **How to play** button reopens the six-slide tutorial.

The staff and projector passwords can match. Each must be at least four characters. Players use their own four-digit PINs.

## Try a practice round

Install Node.js 22.13 or later, unzip the project, and run this command from its folder.

```sh
npm run demo
```

1. Open `http://127.0.0.1:3001/staff` and enter `local-demo-staff-2026`.
2. In **Settings**, load the sample game. This adds fictional agents and six Christmas missions to the isolated demo database.
3. Open `http://127.0.0.1:3001/screen` in another browser window with `local-demo-screen-2026`.
4. Join as a new player at `http://127.0.0.1:3001/` or use **Already playing?** with a sample player and PIN `2468`. Use another browser profile or private window for a second player.
5. In **Game control**, start the round. Complete a mission, submit a report against another agent, then adjudicate it in **Reports**. Match the guessed and assigned missions and verify the circumstances before approving. Watch the delayed reveal on the projector.
6. End the round to reveal eligible winners. Start a new round to reset progress, lives, and reports while retaining the mission catalog.

Demo mode binds to localhost and keeps its data in `data/demo.sqlite`. Remove that demo file while the server is stopped to clear practice data.

## Run your event locally

```sh
npm run setup
npm start
```

The app starts at `http://127.0.0.1:3000` and uses the SQLite database at `data/game.sqlite`. The setup command writes three random values to `.env`. Open the file locally to get the staff and projector passphrases. Keep the PIN pepper stable for the lifetime of the database. It is used when verifying player PINs.

1. In **Missions**, add your catalog descriptions and their completion counts. Every mission can be reused across multiple players.
2. In **Settings** and **Presentation**, configure late joining and reveal timing. The default is a five-second wait followed by eight seconds on screen.
3. Open **Projector**, sign in, and enter fullscreen.
4. Open registration, give participants the player link, and start the game once the room is ready. Starting assigns missions to agents who still need one. Pause and resume from **Game control**.
5. Review reports as they come in. An approved report immediately eliminates the accused and queues a mission reveal. Each rejection costs the reporter one life. Losing both lives also queues an elimination, with the mission kept private.
6. Use **Players** to adjust lives, revive someone, correct progress, reassign a mission, or reset a forgotten PIN. Give the replacement PIN to the player directly. It signs out their previous sessions.
7. Choose **End game** to save the final results and reveal the surviving agents who completed their entire mission. From **Game control**, start a new round and choose whether to keep the existing accounts and preassign new missions.

An organizer can edit an active catalog entry for future assignments while preserving the instructions that current agents received. Archived missions remain in existing assignments and report history.

## Publish for participant phones

### Cloudflare Workers and D1

Use a Cloudflare account with Workers and D1 enabled. The Worker serves all three views and the API on one HTTPS origin. D1 stores the authoritative game data. If you already have a hosted deployment with player accounts, keep its `PIN_PEPPER` when updating it.

You can keep the source in a GitHub repository and connect that repository to Cloudflare Workers Builds for automatic updates. The final participant link comes from the Worker. GitHub Pages serves static files and cannot run this game’s API.

Set the credentials under **Runtime variables and secrets** for **Production** and mark them as **Secret**. Wrangler keeps the dashboard variables and checks for all three required secret names before it publishes a new version.

1. Run the following, then copy the D1 database ID from Wrangler’s output.

   ```sh
   npm run build
   npx wrangler login
   npx wrangler d1 create santas-secret-mission
   cp cloudflare.example.jsonc wrangler.jsonc
   ```

2. Replace `REPLACE_WITH_YOUR_D1_DATABASE_ID` in `wrangler.jsonc` with the returned ID.
3. Apply the migration and deploy the Worker with its three required secrets. On first deployment, generate local credentials and copy just the three secrets to the deployment file. For an existing deployment, reuse its PIN pepper.

   ```sh
   npm run setup
   umask 077
   grep -E '^(ADMIN_PASSWORD|PRESENTATION_PASSWORD|PIN_PEPPER)=' .env > .env.production
   npx wrangler d1 migrations apply DB --remote
   npx wrangler deploy --secrets-file .env.production
   ```

4. Open the resulting HTTPS URL, then check `/staff` and `/screen`. Have two devices register, start a practice round with organizer-created missions, verify a report and the projector reveal, then reset before the event. Keep the organizer passphrases in your password manager.

[Cloudflare D1 setup](https://developers.cloudflare.com/d1/get-started/) · [Cloudflare Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/)

### Container on a server you manage

Build the included image. Mount persistent storage at `/app/data`, inject the same three secrets, and serve it through an HTTPS reverse proxy.

```sh
docker build -t santa-secret-mission .
docker run --rm --name santa-secret-mission \
  --env-file .env -e HOST=0.0.0.0 -e TRUST_PROXY=true \
  -p 127.0.0.1:3000:3000 -v santa-event-data:/app/data \
  santa-secret-mission
```

The proxy should be the only public entry point. Configure it to forward the original host and HTTPS scheme and append the client IP to `X-Forwarded-For`. Run one container per event database. Keep SQLite storage and the PIN pepper together in backups.

## Development and verification

```sh
npm run check
npm test
npm run build
```

The automated tests exercise the same request handler against SQLite. They cover registration and blocked PIN guesses, persisted progress and sessions, role permissions, report concurrency, projector timing, lifecycle controls, and saved winners. The production Worker uses D1 prepared statements with version-checked writes so conflicting changes cannot both commit against the same state.

Player, staff, and projector views poll for updates approximately every one to two seconds while visible, catch up when re-opened, and show connection status if the back end becomes unreachable. The projector uses server timestamps to keep notices ordered and avoid replaying expired announcements. Recent round summaries appear in the staff history. The installation supports one active game at a time and is sized for one party.
