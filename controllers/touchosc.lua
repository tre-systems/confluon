-- Protocol constants are prepended by scripts/build-touchosc.mjs.
-- All messages use MIDI connection 1. No OSC or network addresses are embedded.
local lastHeartbeat = -1000
local lastSync = -1000
local lastFeedback = -10000
local lastTouch = {}
local lastValue = {}
local lastX, lastY = -1, -1
local resetAt = nil
local resetSent = false

local function cc(number, value)
  sendMIDI({STATUS, number, value}, {true})
end

local function axis(number, lowNumber, value)
  cc(number, math.floor(value / 128))
  cc(lowNumber, value % 128)
end

function init()
  lastTouch = {}
  lastValue = {}
  lastX, lastY = -1, -1
  resetAt = nil
  resetSent = false
  lastHeartbeat, lastSync, lastFeedback = -1000, -1000, -10000
  for _, name in ipairs(ACTIONS) do
    self.children[name .. "_label"].textAlignH = AlignH.CENTER
    self.children[name .. "_label"].textAlignV = AlignV.MIDDLE
  end
  cc(HEARTBEAT, 127)
  cc(GATE, 0)
  cc(43, 0)
  cc(SYNC, 127)
end

function update()
  local now = getMillis()
  if now - lastHeartbeat >= 200 then
    cc(HEARTBEAT, 127)
    lastHeartbeat = now
  end
  if now - lastSync >= 1000 then
    cc(SYNC, 127)
    lastSync = now
  end
  self.children.connection.values.text = now - lastFeedback < 2500 and "CONNECTED" or "WAITING FOR CONFLUON"

  local pad = self.children.field
  local touching = pad.values.touch
  if touching then
    local x = math.floor(pad.values.x * 16383 + 0.5)
    local y = math.floor(pad.values.y * 16383 + 0.5)
    -- Position precedes the gate, including a fresh press at the same position.
    if x ~= lastX or y ~= lastY or not lastTouch.field then
      axis(X, X_LOW, x)
      axis(Y, Y_LOW, y)
      lastX, lastY = x, y
    end
  end
  if touching ~= (lastTouch.field or false) then cc(GATE, touching and 127 or 0) end
  lastTouch.field = touching

  for i, name in ipairs(PARAMETERS) do
    local control = self.children[name]
    local value = math.floor(control.values.x * 127 + 0.5)
    if control.values.touch and (value ~= lastValue[name] or not lastTouch[name]) then cc(19 + i, value) end
    lastValue[name] = value
    lastTouch[name] = control.values.touch
  end

  for i, name in ipairs(ACTIONS) do
    local control = self.children[name]
    local down = control.values.touch
    if name == "reset" then
      if down and not resetAt then resetAt = now end
      if down and not resetSent and now - resetAt >= 750 then cc(36 + i, 127); resetSent = true end
      if not down then
        if resetSent then cc(36 + i, 0) end
        resetAt = nil
        resetSent = false
      end
    elseif down ~= (lastTouch[name] or false) then
      cc(36 + i, down and 127 or 0)
    end
    lastTouch[name] = down
  end
end

function onReceiveMIDI(message, connections)
  if not connections[1] or #message ~= 3 or message[1] ~= STATUS then return end
  local number, value = message[2], message[3]
  lastFeedback = getMillis()
  local name = PARAMETERS[number - 19]
  if name then
    local control = self.children[name]
    -- A finger owns its slider until release. Received values never transmit.
    if not control.values.touch then control.values.x = value / 127 end
    return
  end
  name = ACTIONS[number - 36]
  if name == "gather" or name == "orbit" or name == "divide" then
    self.children[name].color = value > 0 and Color(0.25, 0.9, 0.83) or Color(0.26, 0.38, 0.43)
    if value > 0 then self.children.mode.values.text = string.upper(name) end
  elseif name == "pause" then
    self.children.pause_label.values.text = value > 0 and "RESUME" or "PAUSE"
  end
end
