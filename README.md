# PTT-Crosslink v0.2 — Windows directe TeamSpeak-crosslink (proefversie)

**Nieuw:** eigen TeamSpeak-spraakverbindingen naar server A en server B, zonder TeamSpeak-clientvensters of virtuele audiokabels. Gebaseerd op onafhankelijke TeamSpeak-3-protocolsoftware `@honeybbq/teamspeak-client` (MIT) en OpusScript (MIT). De radiobediening is een eigen implementatie, **geen kopie van OpenRepeater of PTTConnect-PC**.

## Mogelijkheden

- TeamSpeak 3 server A ↔ server B, direct UDP 9987 / Opus 4/5 doorgeven (gecodeerd, zonder decoderen).
- Twee eigen botaccounts en optioneel een kanaalnaam of wachtwoord per server.
- A → B en B → A; één spreekrichting tegelijk om terugkoppeling te vermijden.
- Per uitzending één spreker doorgeven, zodat meerdere Opus-stromen niet door elkaar gaan.
- Instelbare afvaltijd en TX-timeout inclusief herinschakelen na stilte.
- Afvalpiep, handmatige/automatische callgever en tijdmelder via Windows-spraak (TTS).
- Dashboard met verbindingsstatus en ontvangen/verzonden richting.
- Aparte identiteiten voor beide servers, lokaal opgeslagen in Windows AppData.
- Portable Windows-EXE via GitHub Actions, gebaseerd op Electron.

## GitHub Actions: automatisch Windows-programma bouwen

1. Open [michiel66/michiel66-ptt-crosslink](https://github.com/michiel66/michiel66-ptt-crosslink).
2. Upload **de inhoud** van deze ZIP naar de root van `main`, inclusief `.github/workflows/windows-direct-v02.yml`. Dit is **v0.2**; bestaande v0.1-bestanden mogen voorlopig blijven staan, maar de nieuwe `package.json`, `main.cjs`, `bridge/`, `ui/` en `tests/*.test.cjs` moeten aanwezig zijn.
3. Onder GitHub **Actions → PTT-Crosslink v0.2 Windows DIRECT EXE → laatste run** staat na een geslaagde build **PTT-Crosslink-v0.2-Windows-Direct** bij Artifacts. Dat artifact bevat een portable `.exe`.
4. Start het programma op Windows 10/11 en vul in het dashboard server B in, het gewenste kanaal en eventuele wachtwoorden. Klik **CROSSLINK STARTEN**.

**Opmerking:** de oude Python-buildworkflow v0.1 kan ook nog draaien. In Actions kies je expliciet de workflow met **v0.2 Windows DIRECT EXE**. 

## Zelf bouwen op Windows

Installeer Node.js 22 en Git. Open een opdrachtprompt in deze map:

```cmd
npm install
npm test
npm run dist
```

Het resultaat verschijnt in `dist/`. De portable build bevat Electron en heeft geen Node-installatie op de doel-PC nodig.

## Belangrijkste instellingen

- **A** heeft standaard adres `Heerlen.MIJNTS3.NL`; **B** vul je zelf in.
- Voor verschillende kanalen op dezelfde server kun je dezelfde host gebruiken, maar beide gatewayaccounts moeten in verschillende kanalen staan.
- **Afvalpiep:** 880 Hz / 180 ms; **afvaltijd:** 450 ms.
- **Callgever:** elke 15 min; **tijdmelder:** elke 60 min; 0 schakelt uit.
- **TX-timeout:** 180 seconden. Na uitschakelen mag de spreker weer zenden zodra die enige tijd stil is.
- Server- en kanaalwachtwoorden worden **niet opgeslagen**; deze moet je bij opnieuw starten opnieuw invullen. De identiteiten worden wel lokaal opgeslagen onder AppData.

## Tests en huidige beperkingen

Dit pakket is **een technische proefversie**. De lokale JavaScript-controller en TTS-golfvormverwerking hebben tests, maar de verbinding met twee live TeamSpeak-servers is hier nog niet getest. Pas na een geslaagde GitHub-EXE-build en een echt gesprek op twee servers kunnen we live tweeweg-audio bevestigen. Andere punten:

- Voor ontvangst is de Opus-spraakroute uit de clientprotocolbibliotheek gebruikt. Het doorgeven van ontvangen gecodeerde frames vermijdt virtuele kabels en verslechtering door opnieuw encoderen.
- De **OpusScript**-encoder maakt eigen piepen en Windows-TTS; er is **geen afzonderlijke fysieke microfoon**.
- Audio via meerdere gelijktijdige sprekers wordt niet gemengd. De repeater kiest één spreker per uitzending en is bewust half-duplex.
- Gebruikers moeten toestemming hebben om de twee gatewayaccounts de juiste kanalen te laten betreden en in die kanalen te spreken.
- Na verlies van één serververbinding stopt het doorgeven tot je de crosslink opnieuw start. Automatisch reconnecten en uitgebreid audiomengen zijn voor een volgende versie.
- Opus codecs 4 en 5 worden doorgestuurd. Andere codecs worden genegeerd.
- Deze versie implementeert nog geen DTMF of Hardware-PTT.

## Techniek & auteursrechten

Eigen repeatercontroller, lokaal Electron-venster, zonder externe webserver. TeamSpeak is een merk van TeamSpeak Systems en dit project wordt niet door TeamSpeak ondersteund. Derdenbibliotheken `@honeybbq/teamspeak-client` 0.3.3 en `opusscript` 0.1.1 zijn MIT-gelicentieerd; hun bijgeleverde licenties en auteursvermeldingen moeten bij distributie behouden blijven. Deze repository bevat geen TeamSpeak SDK-bestanden. 

## Snel uploaden met Windows

Pak de ZIP uit op je Windows-PC. Dubbelklik `UPLOAD_NAAR_GITHUB.bat` als Git for Windows is geïnstalleerd en je kunt inloggen op GitHub. Het script maakt tijdelijk een clone van de bestaande repository, kopieert de **v0.2**-bestanden, commit en pusht naar `main`. Het overschrijft je bestaande Python v0.1-bestanden en workflow **niet**. Als GitHub het pushen blokkeert, upload de bestanden handmatig via de GitHub-website.
