# MIDI performance

Confluon accepts a Launch Control XL 3 and an iPad running TouchOSC at the same time.
The Mac runs the simulation, sound and image. MIDI changes the same parameters and
gestures as the instrument's on-screen controls.

Use Chrome or Edge on the Mac, on HTTPS or localhost. MIDI is optional: browsers
without Web MIDI retain the normal instrument. SysEx permission is not requested.

## XL3 panel and DAW Control

Disconnect the controller from other instruments before connecting here. Open the
controls, choose **XL3**, then click **Connect**. The app selects the unique matching
XL3 DAW input/output pair and configures its volatile DAW session. It does not write
Custom Modes, firmware or global settings. More than one matching device requires
unplugging the extra device before retrying.

Connecting a stopped instrument unlocks audio silently. Physical Play or the panel's
Play button starts it; another press fades to zero over eight seconds, then pauses
the field. Repeated presses during the fade are ignored. Play resumes the current
field rather than resetting it. Level changes during the fade apply to the next
start. Hiding the browser tab pauses audio; hiding just the control panel does not.

| Position | Assignment |
| --- | --- |
| Faders 1–6 | Ecology, Flow, Touch strength, Halo, Memory, Tone |
| Fader 7 | Unassigned |
| Fader 8 | Level |
| Middle knobs 4–5 | Gesture X, Gesture Y |

The remaining continuous controls are unassigned and dimmed. Each active control
has one job. The panel uses the same canonical parameter ranges as the standard
controls. Relative knobs respond immediately; Shift makes steps ten times finer.
All assigned faders use pickup, re-armed after touch edits, field changes or release of gestures.
No parameter changes simply because a panel opens or a device connects.

The top button row selects Gather / Orbit / Divide, holds the gesture at the X/Y
position, holds Settle, adds a Seed, pauses/resumes, and resets with **Shift + Reset**.
X/Y starts at the centre each session and does not enter the saved score. The bottom
row loads Still Choir / Tidal Assembly / Ember Rift, releases gestures, focuses the
Tone / Ecology / Halo fader, and switches to standard Controls. Loading a field is
immediate and replaces the current starting score, just like the existing dropdown.
Up/down focuses rows; the side Hide button hides the panel. Unmapped hardware
buttons do nothing. Momentary buttons highlight while held, including Shift.

A live field preview sits at the lower left. On narrow screens the board scrolls
horizontally; its columns stay aligned with the physical controller. The layout
choice is stored separately from URL scores. The panel is also usable with a mouse,
touch or keyboard without connecting hardware.

Disconnecting, changing DAW mode, losing focus or hiding the tab releases held
forces. A disconnected device needs an explicit reconnect. Ordinary controls and
TouchOSC remain available; the legacy input selector excludes DAW ports so it
cannot take the XL3 driver's input handler.

## Legacy Mode 16 / Custom Mode

Open **TouchOSC / legacy MIDI** in the standard controls and click **Connect MIDI**.
This click also starts sound. Allow the browser's MIDI permission prompt.

1. Connect the XL 3 to the Mac over USB.
2. Select **Mode 16** on the hardware. This is Novation's fixed default mode.
3. In Confluon select its main **MIDI** input, rather than its DAW or DIN port.
   A recognised main input is selected automatically when available.
4. Leave **Encoders** on **Mode 16 · absolute with pickup**.
5. If the hardware exposes a **Fader Pickup Type** setting, use **Jump**. Confluon
   performs pickup against its current parameter value; two pickup layers can
   prevent a fader from reaching the application.

The default mode sends on MIDI channel 16. These CC numbers are decimal:

| Column | Fader CC | Top encoder CC | Parameter |
| --- | --- | --- | --- |
| 1 | 5 | 13 | Ecology |
| 2 | 6 | 14 | Flow |
| 3 | 7 | 15 | Touch strength |
| 4 | 8 | 16 | Halo |
| 5 | 9 | 17 | Memory |
| 6 | 10 | 18 | Tone |
| 7 | 11 | 19 | Level |
| 8 | 12 | 20 | Reserved |

The remaining two encoder rows are reserved. Life/population is a setup control:
changing it rebuilds the field, so it has no performance fader assignment.

| Button | CC | Action |
| --- | --- | --- |
| 1 | 37 | Gather |
| 2 | 38 | Orbit |
| 3 | 39 | Divide |
| 4 | 40 | Seed a colony at the last gesture position (centre before the first gesture) |
| 5 | 41 | Pause/resume |
| 6 | 42 | Reset the current seed |
| 7 | 43 | Settle while held |
| Play | 116 | Pause/resume |

Buttons act on the press edge. Settle also handles the release. Configure custom
buttons as momentary, with values 127 on press and 0 on release.

### Pickup

An absolute fader or encoder waits until its position meets or crosses Confluon's
current value. The MIDI status shows the direction to move and the target MIDI
value. Once acquired, it follows normally.

Changing a parameter from the iPad, another hardware control, the on-screen panel
or a featured field re-arms pickup for controls whose positions no longer match.
Disconnecting a device or releasing all held gestures also re-arms pickup. A
one-MIDI-step tolerance makes it possible to acquire values between hardware steps.

### Fine encoders in a Custom Mode

For fine control, use Novation Components to configure one of the editable Custom
Modes. Keep the channel and CC numbers in the tables above. Set faders to 7-bit
absolute CC, buttons to momentary CC, and top-row encoders 1–7 to **Relative** in
their Advanced settings. Select **Custom Mode · relative fine adjustment** in
Confluon and select that Custom Mode on the hardware.

Novation's relative encoding has a centre of 64: 65 means one clockwise step, 63
one anticlockwise step, and 64 no movement. Each step moves one 508th of the
parameter's range. Relative encoders do not need pickup. This requires firmware
and Components versions that offer relative Custom Mode encoders. Do not select
relative decoding while using the fixed, absolute Mode 16.

Confluon remembers port selections and encoder decoding locally in this browser.
MIDI permission and connection are still requested through **Connect MIDI** each
time the instrument opens. No hardware presets or firmware are overwritten.
Fine parameter values retain six decimal places in the URL-backed score.

## iPad TouchOSC

Use the current **TouchOSC**, not TouchOSC Mk1. The native layout is
[`public/controllers/confluon.tosc`](../public/controllers/confluon.tosc), also
available from **Download iPad TouchOSC layout** in the instrument's MIDI controls.

1. Install TouchOSC on the iPad and the free **TouchOSC Bridge** on the Mac.
2. Transfer `confluon.tosc` to the iPad with AirDrop or Files and open it in TouchOSC.
3. Connect the iPad to the Mac with a USB data cable. In TouchOSC, open
   **Connections → Bridge**, enable connection 1 and choose **<USB>** as its host.
   For Wi-Fi, select the Mac's Bridge instance instead; both devices need the same
   reachable local network.
4. Under **Connections → MIDI**, enable connection 1 and select **<Bridge 1>** for
   both Send Port and Receive Port. The layout uses only MIDI connection 1.
5. In Confluon select **TouchOSC Bridge** for the TouchOSC input and feedback output.
   Use the XL3 panel connection separately, or select its main input for legacy Mode 16.
6. Enter TouchOSC's control-surface mode with its Play button. The layout shows
   **CONNECTED** when Confluon's feedback arrives.

The layout is landscape and scales to the iPad screen. Its pad maps to the visible
Mac field: left/right and up/down correspond to the image, including its viewport
crop. It shows a gesture surface rather than a video feed. One gesture position
controls the field; other fingers can operate sliders and buttons simultaneously.

The mode buttons select Gather, Orbit or Divide. Seed Colony uses the last gesture
position. Hold to Settle constrains the field until release. Pause changes to Resume
when the instrument is paused. Reset requires a 0.75-second hold on the iPad.
The seven sliders receive parameter feedback, but a finger retains ownership of
its slider until released. Incoming feedback never sends a command back.

### Gesture ownership and connection loss

A fresh mouse, pen or iPad press takes ownership of the single gesture position.
Movement or release from an older press cannot move or release the current gesture.
Settle combines all held sources: releasing one device does not cancel another's
hold. Losing browser focus, hiding the page, disconnecting MIDI or clicking
**Release held gestures** clears holds. Capture preparation disconnects MIDI.

The iPad sends a heartbeat every 200 ms. If it stops for more than one second,
Confluon releases its gesture and Settle. After reconnecting, lift and press again
to begin another gesture. A lost release therefore cannot leave a force held
indefinitely. Hardware holds are released on Web MIDI disconnect events.

## Protocol and verification

TouchOSC uses MIDI channel 15, separate from the XL 3's channel 16:

| CC | Meaning |
| --- | --- |
| 20–26 | Absolute Ecology, Flow, Touch, Halo, Memory, Tone, Level; feedback uses the same CCs |
| 16 + 48 | X, 14-bit MSB then LSB, left 0 to right 16383 |
| 17 + 49 | Y, 14-bit MSB then LSB, bottom 0 to top 16383 |
| 82 | Gesture gate: 127 pressed, 0 released |
| 83 | Heartbeat |
| 84 | Request current parameter, mode and transport feedback |
| 37–43 | Actions in the button table above |

Coordinates are sent X MSB, X LSB, Y MSB, Y LSB, then the gate for a new press.
Confluon commits the coordinate pair on Y LSB. The heartbeat must precede held
gestures. Feedback for mode buttons is 127 for the selected mode; pause feedback
is 127 while paused, and Settle feedback is 127 while any source holds it.

`controllers/touchosc.lua` and `scripts/build-touchosc.mjs` are the editable layout
sources. `npm run controllers` regenerates the native file. `npm run check` verifies
the generated file and tests MIDI mapping, pickup, channels, relative encoders,
button edges and heartbeat expiry. `npm run smoke` includes simulated Web MIDI
ports in a real browser; `npm run smoke:midi` runs just that integration coverage.

The URL records the current starting parameters, not a timed performance. MIDI and
touch moves are live commands; complete take recording still requires a
step-indexed command stream as described in [Architecture](ARCHITECTURE.md).

## References

- [Novation Mode 16 MIDI map](https://userguides.novationmusic.com/hc/en-gb/articles/26260540230162-Launch-Control-XL-3-appendix)
- [Novation Components guide](https://support.novationmusic.com/hc/en-gb/articles/27203903097362-Launch-Control-XL-3-Components-guide)
- [Novation relative encoders](https://support.novationmusic.com/hc/en-gb/articles/38440840371602-Using-Relative-Encoders)
- [TouchOSC Bridge connections](https://hexler.net/touchosc/manual/connections-bridge)
- [TouchOSC scripting API](https://hexler.net/touchosc/manual/script-functions-global)
