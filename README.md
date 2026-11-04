# PTT-Crosslink v0.1 — TeamSpeak 3 A/B Gateway

Een **eerste testversie** van een Windows-gateway tussen twee TeamSpeak 3-servers met functies die zijn geïnspireerd op repeatercontrollers zoals OpenRepeater/SVXLink. Dit is eigen Python-code, **geen** Windows-port of kopie van OpenRepeater/SVXLink.

## Wat werkt in deze versie

- **Tweerichtings-audiobrug**: ontvangst op server A → uitzending op B, en ontvangst op B → uitzending op A.
- **RX/TX-indicatoren en audioniveaumeters** met een gebeurtenissenlog.
- **VOX**: een uitzending start bij voldoende binnenkomend audioniveau; instelbare drempel en nalooptijd.
- **Half-duplex anti-loop**: tijdens een A→B-uitzending is B→A tijdelijk geblokkeerd. Bij gelijktijdige start wint de luidste richting.
- **Afvalpiep (courtesy/roger-beep)** na ontvangst, met instelbare frequentie, lengte en aan/uit.
- **TX-timeout**: maximale onafgebroken spreektijd. Na timeout blijft die richting geblokkeerd totdat de spreker stilvalt.
- **Callgever**: gesproken identificatietekst, op beide servers, met instelbaar interval.
- **Tijdmelder**: gesproken lokale computertijd, op beide servers, met instelbaar interval.
- **Testpiep**, apart naar server A of B, en opgeslagen instellingen.

## BELANGRIJK: directe TeamSpeak-koppeling versus audiobrug

Deze v0.1 **maakt zelf geen rechtstreekse verbinding met de TeamSpeak-spraakserver**. Daarvoor zou een TeamSpeak-client/plugin of daarvoor geschikte clientbibliotheek nodig zijn. Het programma **stuurt audio via twee officiële TeamSpeak 3-clients en vier virtuele audiokabels**. Het audiotransport over het netwerk blijft dus bij TeamSpeak 3. Er is geen ServerQuery nodig voor het geluid.

TeamSpeak-clients moeten al zijn geïnstalleerd en afzonderlijk in de juiste kanalen zitten. De knoppen 'Open TeamSpeak A/B' openen alleen een serveradres via de `ts3server://`-protocolkoppeling; zij controleren **niet** of het aanmelden gelukt is. Kanaalwachtwoorden en vereiste permissies stel je in TeamSpeak zelf in.

Heb je de **PTT Direct/PTT Connect broncode** die al rechtstreeks met TeamSpeak praat, dan kunnen we de audiolaag hiervan later vervangen om zonder virtuele kabels te werken. Deze broncode is nog niet in deze versie geïntegreerd.

## GitHub: automatisch Windows-EXE bouwen

De workflow `.github/workflows/windows-build.yml` draait op een Windows-runner.
Bij een push naar `main`, bij een pull request of bij handmatig **Actions → Windows EXE bouwen → Run workflow**:

1. Installeert GitHub Actions Python 3.12 en de benodigde bibliotheken.
2. Draait de tests in `tests/`.
3. Bouwt met PyInstaller de EXE `ptt-crosslink.exe` (64-bit).
4. Uploadt het downloadbare artifact `ptt-crosslink-windows-x64` naar de workflow-run.

Open na een geslaagde run op GitHub **Actions → Windows EXE bouwen → de laatste run → Artifacts → ptt-crosslink-windows-x64**. Download de ZIP met de Windows-EXE.

### Eén keer een repository maken

GitHub-repository: **`michiel66/ptt-crosslink`**. Maak op GitHub een **lege repository** met de naam `ptt-crosslink` (geen README, geen `.gitignore`, geen licentie vooraf toevoegen). Pak het broncodepakket uit. Start `UPLOAD_NAAR_GITHUB.bat` op Windows met Git geïnstalleerd en meld je bij GitHub aan. Het script maakt de repository **niet** zelf aan: dat doe je eerst op GitHub.

Via GitHub's website kun je de bestanden ook handmatig uploaden. Let erop dat de verborgen directory `.github/workflows/` inclusief het workflowbestand behouden blijft; anders verschijnt de automatische EXE-build niet.

**Geen release automatisch:** de EXE is beschikbaar als Actions-artifact; een aparte Releases-pagina volgt pas na een release-publicatiestap.

## Windows installeren

1. Vereist: Windows 10 of 11 (64-bit); Python 3.11 of 3.12 (64-bit); **TeamSpeak 3-client**.
2. Installeer vier onafhankelijke virtuele audiokabels (bijvoorbeeld met virtuele audio-driversoftware die 4 onafhankelijke lijnen biedt). Elke lijn heeft een `CABLE Input` (Windows *afspeelapparaat*) en `CABLE Output` (Windows *opnameapparaat*). De juiste namen kunnen afwijken per driver.
3. Pak de ZIP uit in een **schrijfbare map** (bijv. Documenten). Dubbelklik `INSTALLEREN.bat` (installatie van Python-bibliotheken vereist internet).
4. Dubbelklik `START_CROSSLINK.bat`.
5. Voer het serveradres van B in. De standaard voor A is `Heerlen.MIJNTS3.NL`.
6. Start twee onafhankelijke TeamSpeak 3-clients; zo nodig met `-nosingleinstance` als opstartargument. Configureer **verschillende afspeel- en opnameprofielen**, zodat zij niet dezelfde audioapparaten gebruiken. Een tweede TS3-installatie met een eigen configuratiemap kan nodig zijn om instellingen te scheiden.
7. Verbind de ene TS3-client met server A en het juiste kanaal, en de andere TS3-client met server B en het juiste kanaal.
8. Stel de vier apparaatslots in volgens het schema hieronder. Zet op **beide TS3-clients spraakactivering (Voice Activation)** aan, niet handmatige PTT, en stel die op een lage maar bruikbare drempel in. Geef de botaccounts spreekrechten.
9. Klik op **CROSSLINK STARTEN** en gebruik eerst de **Testpiep**-knoppen; test daarna met twee andere gebruikers in de respectieve kanalen.

### Schema van de vier virtuele kabels

```text
TEAMSpeak-client A, server A                        TEAMSpeak-client B, server B

A luidspreker ─► KABEL 1 Input
                   KABEL 1 Output ─► [APP A_RX]
                                            └── VOX / repeater / afvalpiep ─► [APP B_TX] ─► KABEL 2 Input
                                                                                            KABEL 2 Output ─► B microfoon

B luidspreker ─► KABEL 3 Input
                   KABEL 3 Output ─► [APP B_RX]
                                            └── VOX / repeater / afvalpiep ─► [APP A_TX] ─► KABEL 4 Input
                                                                                            KABEL 4 Output ─► A microfoon
```

| Programmaslot | Kies in deze Windows-app | In TeamSpeak 3 instellen |
|---|---|---|
| `Server A · RX` | Opnameapparaat van **KABEL 1** (Output 1) | TS3-A Playback: afspeelapparaat **KABEL 1** (Input 1) |
| `Server B · TX` | Afspeelapparaat van **KABEL 2** (Input 2) | TS3-B Capture: opnameapparaat **KABEL 2** (Output 2) |
| `Server B · RX` | Opnameapparaat van **KABEL 3** (Output 3) | TS3-B Playback: afspeelapparaat **KABEL 3** (Input 3) |
| `Server A · TX` | Afspeelapparaat van **KABEL 4** (Input 4) | TS3-A Capture: opnameapparaat **KABEL 4** (Output 4) |

**Let op:** de vier kabels moeten onafhankelijk zijn. Twee kabels hergebruiken voor zowel RX als TX veroorzaakt gemakkelijk een audiolus. Gebruik geen fysieke luidsprekers/microfoon als bridge-endpoints.

### TeamSpeak PTT / VOX

Omdat dit programma v0.1 TeamSpeak niet via een directe API aanstuurt, schakelt **TeamSpeak zelf de microfoon in op basis van Voice Activation**. Gebruik voor de gateway-clients *geen* PTT-druktoets tenzij een externe PTT-controller die automatisch bedient. De VOX in deze app bepaalt welke richting de brug mag doorgeven; de TS3-spraakactivering moet daarnaast correct staan. Schakel automatische gain/echo-opheffing alleen in als dat nodig is voor jouw setup.

### Instellingen

- **VOX-drempel** standaard `0.025` (RMS op een schaal van 0 tot 1). Verlaag bij te weinig doorkomst, verhoog bij ongewenst openen door achtergrondruis.
- **RX nalooptijd** standaard 450 ms.
- **Afvalpiep** standaard 880 Hz / 180 ms, 90 ms na een beëindigde uitzending.
- **TX-timeout** standaard 180 s. Waarde `0` schakelt timeout uit.
- **Callgever** standaard iedere 15 minuten; interval `0` schakelt uit.
- **Tijdmelder** standaard iedere 60 minuten; interval `0` schakelt uit. De klok komt van de Windows-pc.
- **Windows TTS**: de software kiest waar mogelijk een geïnstalleerde Nederlandse spraakstem; zo niet wordt de standaardstem gebruikt. Geen internet nodig voor TTS, maar een geschikte Windows-tekst-naar-spraakstem is wel vereist.

Meldingen wachten tot er niemand spreekt. Eventuele wachttijd is niet begrensd als het kanaal voortdurend bezet blijft.

## Een EXE bouwen

Dubbelklik na installatie op `BOUW_WINDOWS_EXE.bat` op je Windows-pc. Dit installeert PyInstaller en bouwt `dist\ptt-crosslink.exe`. **Er zit nog geen kant-en-klare Windows-EXE in het broncodepakket**; GitHub Actions kan de EXE automatisch bouwen, of je bouwt lokaal op Windows. Python is na het bouwen op de doel-pc normaal gesproken niet nodig. TeamSpeak-clients, virtuele audiokabels en Windows-spraakondersteuning zijn nog wel nodig.

## Beperkingen / teststatus

- Offline getest zijn de audio-routerlogica, half-duplexrichting, timeout, testpiep en afvalpiep. **De volledige gateway is nog niet getest op een Windows-pc met twee live TeamSpeak-servers.**
- Geen directe native verbinding met TS3, geen automatische serverstatus, kanaal- of gebruikerslijsten, geen regelbare TS3-PTT via de client-API.
- Geen DTMF-decoder, geen echte PTT via seriële poort, geen openrepeater-WebUI, geen CW-callgever of opgenomen WAV-meldingen.
- Voor **volledig gelijktijdige gesprekken in beide richtingen** zou een speciale echo-/loop-architectuur nodig zijn; deze versie is doelbewust half-duplex.
- De actuele versie biedt geen afzonderlijke instellingen om op A en B een andere calltekst uit te zenden.
- Start met volume laag en test met beperkte rechten voordat je gateways permanent laat draaien.

## Broncode / licentie-informatie

Deze voorbeeldapp is vanaf nul opgesteld om audiostromen via de lokale geluidssubsystemen te verwerken. Er is geen OpenRepeater- of SVXLink-code, geen TeamSpeak-bibliotheek en geen audiodriver in het ZIP-bestand opgenomen. De gebruiker moet de TeamSpeak-client en bijbehorende audioapparaten zelf installeren en de toepasselijke voorwaarden respecteren.
