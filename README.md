# Reactboy

This project was bootstrapped with [Create React App](https://github.com/facebook/create-react-app).

## Available Scripts

In the project directory, you can run:

### `yarn start`

Runs the app in the development mode.\
Open [http://localhost:3000](http://localhost:3000) to view it in the browser.

The page will reload if you make edits.\
You will also see any lint errors in the console.

### `yarn test`

Launches the test runner in the interactive watch mode.

### `yarn build`

Builds the app for production to the `build` folder.\
It correctly bundles React in production mode and optimizes the build for the best performance.\
The build is minified and the filenames include the hashes.

## Project

### Components

Based on http://www.bchanx.com/animated-gameboy-in-css:

```html
<div id="gameboy" class="green" style="opacity: 1;">
    <div id="canvas"></div>
    <div id="border"></div>
    <div id="border-top"></div>
    <div id="border-left"></div>
    <div id="border-bottom"></div>
    <div id="border-right"></div>
    <div id="screw-small-right" class="screw small"></div>
    <div id="screw-small-left" class="screw small"></div>
    <div id="screw-large-right" class="screw large"></div>
    <div id="screw-large-left" class="screw large"></div>
    <div id="backboard"></div>
    <div id="motherboard"></div>
    <div id="motherboard-capacitors" class="capacitors"></div>
    <div id="chip-short" class="chip"></div>
    <div id="chip-diagonal" class="chip"></div>
    <div id="chip-tall" class="chip"></div>
    <div id="chip-capacitors" class="capacitors"></div>
    <div id="contrast-knob"></div>
    <div id="link-port"></div>
    <div id="circuit-bottom" class="circuit"></div>
    <div id="circuit-top" class="circuit"></div>
    <div id="transistors"></div>
    <div id="processor"></div>
    <div id="component"></div>
    <div id="controller"></div>
    <div id="speaker"></div>
    <div id="whitescreen"></div>
    <div id="glass"></div>
    <div id="glass-gameboy-text">GAME BOY</div>
    <div id="glass-color-text">C</div>
    <div id="screen"></div>
    <div id="screen-gameboy-text">GAME BOY</div>
    <div id="screen-nintendo-text">Nintendo</div>
    <div id="joystick-pad"></div>
    <div id="joystick">.</div>
    <div id="control"></div>
    <div id="control-b" class="control-button">B</div>
    <div id="control-a" class="control-button">A</div>
    <div id="start-select-box"></div>
    <div id="start-select-button"></div>
    <div id="cover-vertical"></div>
    <div id="cover-horizontal"></div>
    <div id="gloss"></div>
    <div id="speaker-holes"></div>
    <div id="power"></div>
</div>
```

...let's divide our project into the following components:

```
- Canvas
- Borders
    - Top
    - Left
    - Bottom
    - Right
- Screws
    - SmRight
    - SmLeft
    - LgRight
    - LgLeft 
- Backboard
- Motherboard
    - Capacitors
- Chips
    - Short
    - Diagonal
    - Tall
    - Capacitors
- ContrastKnob
- LinkPort
- Circuit
    - Bottom
    - Top
- Transistors
- Processor/CPU
- Component (???)
- Controller
- Speaker
- Display
    - WhiteScreen
    - Glass
    - Logo
- DPad
- AButton
- BButton
- StartButton
- SelectButton
- Cover
    - Horizonal
    - Vertical
    - Gloss
    - SpeakerHoles
    - Power
```

*TODO: refactor components to reduce number


## Assets

- [Animated Gameboy in CSS - Blog](http://www.bchanx.com/animated-gameboy-in-css-blog)

## Tools

- [Rednex Game Boy Development System](https://github.com/bentely/rgbds)
- [BGB Emulator/Debugger](http://bgb.bircd.org)
- [Everdrive GB](https://krikzz.com)

## Sauce

- [How Emulators Work: A Presentation](http://imrannazar.com/How-Emulators-Work:-a-presentation)
- [Decoding Z80 Opcodes](http://z80.info/decoding.htm)
- [RubyConf AU 2017 - Writing a Gameboy emulator in Ruby, by Colby Swandale](https://www.youtube.com/watch?v=WbO2FEpNPvQ)
- [Opcode Map for the Gameboy-Z80](http://imrannazar.com/GameBoy-Z80-Opcode-Map)
- [Gameboy Emulation: The CPU](http://imrannazar.com/GameBoy-Emulation-in-JavaScript:-The-CPU)
- [Game Boy Emulator Dev - Writing disassembler](https://www.youtube.com/watch?v=eQXUJOkw0s0)
- [Game Boy Emulator Dev - Implementing interrupts](https://www.youtube.com/watch?v=bkiB568FfXg)
- [The Ultimate Game Boy Talk (33c3)](https://www.youtube.com/watch?v=HyzD8pNlpwI)
