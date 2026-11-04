"""PTT-Crosslink v0.1 - TeamSpeak 3 A/B audio gateway for Windows.

Runs with two independent official TeamSpeak 3 clients / four virtual audio cables.
This is NOT a TeamSpeak protocol client and cannot verify server connection state.
"""
from __future__ import annotations

from datetime import datetime
import json
import os
from pathlib import Path
import queue
import threading
import time
from urllib.parse import quote
import webbrowser

import tkinter as tk
from tkinter import ttk, messagebox

from engine import AudioBridge, RouterOptions
from speech import text_to_pcm

TITLE = 'PTT-CROSSLINK · TS3 REPEATER GATEWAY'
BG = '#101722'
PANEL = '#192537'
INPUT = '#24344A'
FG = '#F2F7FC'
MUTED = '#A8BDD2'
ACCENT = '#29C47B'
AMBER = '#F6B64A'

DEFAULTS = {
    'a_host': 'Heerlen.MIJNTS3.NL', 'a_channel': '', 'a_nick': 'PTT Crosslink A',
    'b_host': '', 'b_channel': '', 'b_nick': 'PTT Crosslink B',
    'a_rx': '', 'a_tx': '', 'b_rx': '', 'b_tx': '',
    'threshold': '0.025', 'hang_ms': '450', 'tx_limit': '180',
    'courtesy': True, 'courtesy_hz': '880', 'courtesy_ms': '180',
    'call_text': 'Dit is de PTT Crosslink repeater. Beide TeamSpeak-servers zijn gekoppeld.',
    'call_minutes': '15', 'time_minutes': '60'
}


def config_path() -> Path:
    directory = Path(os.environ.get('APPDATA', str(Path.home()))) / 'PTT-Crosslink'
    directory.mkdir(parents=True, exist_ok=True)
    return directory / 'settings.json'


def load_settings() -> dict:
    data = DEFAULTS.copy()
    try:
        cfg = json.loads(config_path().read_text(encoding='utf-8'))
        if isinstance(cfg, dict):
            data.update({k: v for k, v in cfg.items() if k in DEFAULTS})
    except (OSError, ValueError, TypeError):
        pass
    return data


class App:
    def __init__(self, root: tk.Tk):
        self.root = root
        root.title('PTT-Crosslink v0.1 · TeamSpeak 3')
        root.geometry('1040x815')
        root.minsize(850, 680)
        root.configure(bg=BG)
        self.settings = load_settings()
        self.vars = {k: (tk.BooleanVar(value=v) if k == 'courtesy' else tk.StringVar(value=str(v)))
                     for k, v in self.settings.items()}
        self.device_choices = {}
        self.events: queue.Queue[str] = queue.Queue()
        self.bridge: AudioBridge | None = None
        self.last_call_at = time.monotonic()
        self.last_time_at = time.monotonic()
        self._setup_style()
        self._build_ui()
        self.refresh_devices()
        self.root.protocol('WM_DELETE_WINDOW', self.close)
        self.root.after(100, self._poll)

    def _setup_style(self):
        s = ttk.Style(self.root)
        s.theme_use('clam')
        s.configure('TFrame', background=BG)
        s.configure('Card.TFrame', background=PANEL)
        s.configure('TLabel', background=BG, foreground=FG, font=('Segoe UI', 10))
        s.configure('Card.TLabel', background=PANEL, foreground=FG, font=('Segoe UI', 10))
        s.configure('Hint.TLabel', background=PANEL, foreground=MUTED, font=('Segoe UI', 9))
        s.configure('Main.TLabel', background=BG, foreground=FG, font=('Segoe UI Semibold', 19))
        s.configure('CardTitle.TLabel', background=PANEL, foreground=ACCENT, font=('Segoe UI Semibold', 11))
        s.configure('TEntry', fieldbackground=INPUT, foreground=FG, insertcolor=FG, borderwidth=0,
                    padding=(7, 5))
        s.configure('TCombobox', fieldbackground=INPUT, background=INPUT, foreground=FG, arrowcolor=FG,
                    selectbackground=INPUT, selectforeground=FG, padding=4)
        s.configure('TButton', font=('Segoe UI Semibold', 10), padding=(12, 7),
                    background=INPUT, foreground=FG, borderwidth=0)
        s.map('TButton', background=[('active', '#30506C')])
        s.configure('Green.TButton', background=ACCENT, foreground='#092015')
        s.map('Green.TButton', background=[('active', '#53E9A2')])
        s.configure('Red.TButton', background='#B75160', foreground=FG)
        s.map('Red.TButton', background=[('active', '#D66A7A')])
        s.configure('TCheckbutton', background=PANEL, foreground=FG)
        s.configure('Horizontal.TProgressbar', background=ACCENT, troughcolor='#354355', borderwidth=0)

    def _card(self, parent: tk.Widget, title: str) -> ttk.Frame:
        wrap = ttk.Frame(parent, style='Card.TFrame', padding=14)
        ttk.Label(wrap, text=title, style='CardTitle.TLabel').pack(anchor='w', pady=(0, 9))
        return wrap

    def _build_ui(self):
        head = ttk.Frame(self.root, padding=(22, 17, 22, 7))
        head.pack(fill='x')
        ttk.Label(head, text=TITLE, style='Main.TLabel').pack(side='left')
        ttk.Label(head, text='v0.1 · Windows · 48 kHz', foreground=MUTED).pack(side='right')
        headline = ttk.Frame(self.root, padding=(22, 0, 22, 12))
        headline.pack(fill='x')
        ttk.Label(headline, text='Live audiobrug tussen twee onafhankelijke TeamSpeak 3-clients.',
                  foreground=MUTED).pack(anchor='w')

        tabs = ttk.Notebook(self.root)
        tabs.pack(fill='both', expand=True, padx=20, pady=(0, 12))
        main = ttk.Frame(tabs, padding=12)
        audio = ttk.Frame(tabs, padding=12)
        control = ttk.Frame(tabs, padding=12)
        tabs.add(main, text='  Crosslink  ')
        tabs.add(audio, text='  Audioapparaten  ')
        tabs.add(control, text='  Repeaterinstellingen  ')

        servers = ttk.Frame(main)
        servers.pack(fill='x')
        a = self._card(servers, 'SERVER A · HEERLEN')
        b = self._card(servers, 'SERVER B · CROSSLINK')
        a.pack(side='left', fill='both', expand=True, padx=(0, 6))
        b.pack(side='left', fill='both', expand=True, padx=(6, 0))
        self._server_card(a, 'a')
        self._server_card(b, 'b')

        status = self._card(main, 'RX / TX LIVE')
        status.pack(fill='x', pady=(12, 0))
        self.route_label = ttk.Label(status, text='● STOP · NIET ACTIEF', style='Card.TLabel',
                                     font=('Segoe UI Semibold', 15))
        self.route_label.pack(anchor='w', pady=4)
        meters = ttk.Frame(status, style='Card.TFrame')
        meters.pack(fill='x', pady=6)
        ttk.Label(meters, text='RX A', style='Card.TLabel', width=6).grid(row=0, column=0)
        self.meter_a = ttk.Progressbar(meters, orient='horizontal', maximum=100)
        self.meter_a.grid(row=0, column=1, sticky='ew', padx=10)
        ttk.Label(meters, text='RX B', style='Card.TLabel', width=6).grid(row=1, column=0)
        self.meter_b = ttk.Progressbar(meters, orient='horizontal', maximum=100)
        self.meter_b.grid(row=1, column=1, sticky='ew', padx=10)
        meters.columnconfigure(1, weight=1)

        actions = ttk.Frame(main, padding=(0, 15))
        actions.pack(fill='x')
        self.start_button = ttk.Button(actions, text='▶ CROSSLINK STARTEN', style='Green.TButton', command=self.start)
        self.start_button.pack(side='left', padx=(0, 7))
        ttk.Button(actions, text='■ STOP', style='Red.TButton', command=self.stop).pack(side='left', padx=7)
        ttk.Button(actions, text='📢 CALLGEVER', command=self.announce_call).pack(side='left', padx=7)
        ttk.Button(actions, text='◷ TIJDMELDER', command=self.announce_time).pack(side='left', padx=7)

        logs = self._card(main, 'GEBEURTENISSEN / RADIOLOG')
        logs.pack(fill='both', expand=True)
        self.log_text = tk.Text(logs, height=10, bg='#111B29', fg='#C9E6D5', relief='flat',
                                insertbackground=FG, wrap='word', font=('Consolas', 10), state='disabled')
        self.log_text.pack(fill='both', expand=True)
        self.log('Configureer vier gescheiden virtuele audiokabels in tab Audioapparaten.')

        device_card = self._card(audio, '4 AUDIO-ENDPOINTS · 2 SERVERVERBINDINGEN')
        device_card.pack(fill='x')
        ttk.Label(device_card, text='Elke TeamSpeak-client gebruikt een eigen RX- en TX-kabel. '
                  'De app neemt de geluidsstroom over en bepaalt wanneer er wordt doorgeschakeld.',
                  style='Hint.TLabel', wraplength=850, justify='left').pack(anchor='w', pady=(0, 13))
        for key, label, hint in (
            ('a_rx', '1. Server A · RX', 'TeamSpeak A luidspreker → app microfoon / CABLE Output 1'),
            ('b_tx', '2. Server B · TX', 'App luidspreker → TeamSpeak B microfoon / CABLE Input 2'),
            ('b_rx', '3. Server B · RX', 'TeamSpeak B luidspreker → app microfoon / CABLE Output 3'),
            ('a_tx', '4. Server A · TX', 'App luidspreker → TeamSpeak A microfoon / CABLE Input 4'),
        ):
            row = ttk.Frame(device_card, style='Card.TFrame')
            row.pack(fill='x', pady=6)
            ttk.Label(row, text=label, style='Card.TLabel', width=19).pack(side='left')
            combo = ttk.Combobox(row, textvariable=self.vars[key], state='readonly', width=57)
            combo.pack(side='left', fill='x', expand=True, padx=6)
            self.device_choices[key] = combo
            ttk.Label(device_card, text=hint, style='Hint.TLabel').pack(anchor='w', padx=8)
        buttons = ttk.Frame(device_card, style='Card.TFrame')
        buttons.pack(fill='x', pady=12)
        ttk.Button(buttons, text='↻ Audioapparaten vernieuwen', command=self.refresh_devices).pack(side='left', padx=4)
        ttk.Button(buttons, text='Testpiep naar server A', command=lambda: self.test_tone('A')).pack(side='left', padx=4)
        ttk.Button(buttons, text='Testpiep naar server B', command=lambda: self.test_tone('B')).pack(side='left', padx=4)
        helpframe = self._card(audio, 'BELANGRIJK VOOR DE INSTELLINGEN')
        helpframe.pack(fill='x', pady=13)
        for l in (
            'TS3-client A: afspeelapparaat = kabel 1 (Input); opnameapparaat = kabel 4 (Output).',
            'TS3-client B: afspeelapparaat = kabel 3 (Input); opnameapparaat = kabel 2 (Output).',
            'In beide TS3-clients: spraakactivering/VOX inschakelen en de drempel geschikt instellen.',
            'Gebruik vier unieke virtuele kabels, anders kan het geluid terugkoppelen.',
            'TeamSpeak gebruikt twee afzonderlijke clients; deze app meldt alleen audiostatus, geen server-login.'
        ):
            ttk.Label(helpframe, text='• ' + l, style='Hint.TLabel', wraplength=850).pack(anchor='w', pady=3)

        params = self._card(control, 'RADIOCONTROLLER')
        params.pack(fill='x')
        for key, label, units in (
            ('threshold', 'VOX-drempel (RMS)', 'bijvoorbeeld 0.025'),
            ('hang_ms', 'RX nalooptijd', 'milliseconden'),
            ('tx_limit', 'Max. spreektijd / TX-timeout', 'seconden; 0 = uit'),
            ('courtesy_hz', 'Afvalpiep frequentie', 'Hz'),
            ('courtesy_ms', 'Afvalpiep lengte', 'milliseconden'),
            ('call_minutes', 'Automatische callgever', 'minuten; 0 = uit'),
            ('time_minutes', 'Automatische tijdmelder', 'minuten; 0 = uit'),
        ):
            r = ttk.Frame(params, style='Card.TFrame')
            r.pack(fill='x', pady=4)
            ttk.Label(r, text=label, style='Card.TLabel', width=34).pack(side='left')
            ttk.Entry(r, textvariable=self.vars[key], width=14).pack(side='left', padx=8)
            ttk.Label(r, text=units, style='Hint.TLabel').pack(side='left')
        ttk.Checkbutton(params, text='Afvalpiep inschakelen na uitzending',
                        variable=self.vars['courtesy']).pack(anchor='w', pady=12)
        speech = self._card(control, 'CALLGEVER · GESPROKEN IDENTIFICATIE')
        speech.pack(fill='x', pady=(12, 0))
        ttk.Entry(speech, textvariable=self.vars['call_text']).pack(fill='x', pady=6)
        ttk.Label(speech, text='Gesproken tekst wordt via Windows Spraaksynthese gegenereerd. '
                  'Automatische meldingen wachten tot de crosslink vrij is.',
                  style='Hint.TLabel', wraplength=850).pack(anchor='w', pady=7)
        ttk.Button(speech, text='Instellingen opslaan', command=self.save).pack(anchor='w', pady=7)
        self.root.after(1000, self._timer)

    def _server_card(self, parent, letter):
        for key, label in (('host', 'Serveradres'), ('channel', 'Kanaalnaam (optioneel)'), ('nick', 'Gateway-naam')):
            ttk.Label(parent, text=label, style='Hint.TLabel').pack(anchor='w', pady=(4, 1))
            ttk.Entry(parent, textvariable=self.vars[f'{letter}_{key}']).pack(fill='x', pady=(0, 4))
        ttk.Button(parent, text=f'Open TeamSpeak {letter.upper()}',
                   command=lambda: self.open_ts(letter)).pack(anchor='w', pady=7)

    def log(self, message: str):
        if hasattr(self, 'log_text'):
            self.log_text.configure(state='normal')
            self.log_text.insert('end', datetime.now().strftime('%H:%M:%S') + '  ' + message + '\n')
            self.log_text.see('end')
            self.log_text.configure(state='disabled')
        else:
            self.events.put(message)

    def refresh_devices(self):
        try:
            import sounddevice as sd
            devices = sd.query_devices()
            hostapi = sd.query_hostapis()
            for key, combo in self.device_choices.items():
                old = self.vars[key].get()
                is_input = key.endswith('rx')
                valid = []
                for i, d in enumerate(devices):
                    if d['max_input_channels' if is_input else 'max_output_channels'] < 1:
                        continue
                    api = hostapi[d['hostapi']]['name']
                    valid.append(f'[{i}] {d["name"]} ({api})')
                combo['values'] = valid
                if old not in valid:
                    self.vars[key].set('')
            self.log(f'{len(devices)} audioapparaten gevonden; gebruik bij voorkeur Windows WASAPI.')
        except Exception as exc:
            self.log('Audioapparaten niet beschikbaar: ' + str(exc))

    def _read_options(self) -> RouterOptions:
        try:
            opts = RouterOptions(
                threshold=float(self.vars['threshold'].get()),
                hang_ms=int(self.vars['hang_ms'].get()),
                tx_limit_seconds=int(self.vars['tx_limit'].get()),
                courtesy=self.vars['courtesy'].get(),
                courtesy_hz=int(self.vars['courtesy_hz'].get()),
                courtesy_ms=int(self.vars['courtesy_ms'].get()))
            if not (.001 <= opts.threshold <= .4 and 50 <= opts.hang_ms <= 4000
                    and 0 <= opts.tx_limit_seconds <= 3600 and 200 <= opts.courtesy_hz <= 3000
                    and 30 <= opts.courtesy_ms <= 1500):
                raise ValueError('Een of meer radiowaarden vallen buiten het geldige bereik.')
            for key in ('call_minutes', 'time_minutes'):
                if not 0 <= int(self.vars[key].get()) <= 1440:
                    raise ValueError('Meldingsinterval moet tussen 0 en 1440 minuten liggen')
            return opts
        except Exception as exc:
            raise ValueError(f'Controleer de repeaterinstellingen: {exc}') from exc

    def _read_devices(self) -> dict[str, int]:
        result = {}
        for key in ('a_rx', 'a_tx', 'b_rx', 'b_tx'):
            value = self.vars[key].get()
            if not value.startswith('[') or ']' not in value:
                raise ValueError('Kies alle vier de audioapparaten in het tabblad Audioapparaten.')
            result[key] = int(value.split(']', 1)[0][1:])
        if len(set(result.values())) != 4:
            raise ValueError('Gebruik vier aparte endpoints: elk kabelapparaat mag slechts één keer gekozen worden.')
        return result

    def start(self):
        if self.bridge and self.bridge.running:
            return
        if not self.vars['a_host'].get().strip() or not self.vars['b_host'].get().strip():
            messagebox.showerror('Serverinstellingen', 'Vul het adres van zowel server A als server B in.')
            return
        try:
            opts = self._read_options()
            devices = self._read_devices()
        except ValueError as exc:
            messagebox.showerror('Instellingen', str(exc))
            return
        self.save(silent=True)
        self.bridge = AudioBridge(opts, devices, self.events.put)
        self.bridge.start()
        self.last_call_at = self.last_time_at = time.monotonic()
        self.log('Crosslink gestart: audio A ↔ B. Controleer beide TS3-clientverbindingen afzonderlijk.')

    def stop(self):
        if self.bridge:
            self.bridge.stop()
            self.bridge = None
        self.route_label.configure(text='● STOP · NIET ACTIEF')

    def save(self, silent=False):
        cfg = {k: v.get() for k, v in self.vars.items()}
        config_path().write_text(json.dumps(cfg, indent=2, ensure_ascii=False), encoding='utf-8')
        if not silent:
            self.log('Instellingen opgeslagen in ' + str(config_path()))

    def open_ts(self, letter: str):
        host = self.vars[f'{letter}_host'].get().strip()
        if not host:
            messagebox.showwarning('TeamSpeak', 'Vul eerst het serveradres in.')
            return
        # TS3 protocol handler opens the official client; independent client settings
        # (capture and playback profiles) must be configured by the operator.
        url = 'ts3server://' + host
        parts = []
        nick = self.vars[f'{letter}_nick'].get().strip()
        channel = self.vars[f'{letter}_channel'].get().strip()
        if nick:
            parts.append('nickname=' + quote(nick, safe=''))
        if channel:
            parts.append('channel=' + quote(channel, safe=''))
        if parts:
            url += '?' + '&'.join(parts)
        try:
            if os.name == 'nt':
                os.startfile(url)
            else:
                webbrowser.open(url)
            self.log('TeamSpeak ' + letter.upper() + ' aangevraagd: ' + host + ' (login niet geverifieerd)')
        except Exception as exc:
            messagebox.showerror('TeamSpeak openen', str(exc))

    def _speak(self, text: str, label: str):
        if not self.bridge or not self.bridge.running:
            self.log(label + ' niet verstuurd: audiobrug niet actief.')
            return
        current_bridge = self.bridge

        def worker():
            try:
                pcm = text_to_pcm(text)
                if self.bridge is current_bridge and current_bridge.running:
                    if current_bridge.router.enqueue_announcement(pcm, label):
                        self.events.put(label + ' staat klaar voor beide TeamSpeak-servers')
            except Exception as exc:
                self.events.put('Spraakmelding mislukt: ' + str(exc))

        threading.Thread(target=worker, daemon=True, name='WindowsTTS').start()

    def announce_call(self):
        self._speak(self.vars['call_text'].get(), 'Callgever')

    def announce_time(self):
        now = datetime.now()
        text = f'Het is {now.hour} uur en {now.minute} minuten.'
        self._speak(text, 'Tijdmelder')

    def test_tone(self, letter: str):
        if not self.bridge or not self.bridge.running:
            self.log('Start eerst de audiobrug om een testpiep af te spelen.')
        elif self.bridge.router.test_tone(letter):
            self.log('Testpiep ingepland voor TeamSpeak ' + letter)

    def _timer(self):
        if self.bridge and self.bridge.running:
            now = time.monotonic()
            for key, last, call in (
                ('call_minutes', 'last_call_at', self.announce_call),
                ('time_minutes', 'last_time_at', self.announce_time),
            ):
                try:
                    minutes = int(self.vars[key].get())
                except ValueError:
                    minutes = 0
                if minutes > 0 and now - getattr(self, last) >= minutes * 60:
                    setattr(self, last, now)
                    call()
        self.root.after(1000, self._timer)

    def _poll(self):
        for _ in range(30):
            try:
                self.log(self.events.get_nowait())
            except queue.Empty:
                break
        if self.bridge and self.bridge.running:
            router = self.bridge.router
            status = {'A2B': '● RX SERVER A → TX SERVER B',
                      'B2A': '● RX SERVER B → TX SERVER A',
                      None: '● CROSSLINK ACTIEF · STANDBY'}[router.route]
            self.route_label.configure(text=status)
            self.meter_a['value'] = min(100, router.last_rms_a * 900)
            self.meter_b['value'] = min(100, router.last_rms_b * 900)
        else:
            self.meter_a['value'] = 0
            self.meter_b['value'] = 0
        self.root.after(100, self._poll)

    def close(self):
        try:
            self.save(silent=True)
            self.stop()
        finally:
            self.root.destroy()


if __name__ == '__main__':
    root = tk.Tk()
    App(root)
    root.mainloop()
