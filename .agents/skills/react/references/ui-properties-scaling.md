---
name: ui-properties-scaling
description: Roblox UI properties that should use px scaling helpers for consistent sizing and spacing across screen resolutions.
---

# UI Properties Requiring `px.fetch` Scaling

Reference list of Roblox UI properties that represent pixel offsets or dimensions and should use `px` scaling helpers.

## GuiObject (Frames, Buttons, Labels, and similar)

- `Size` (`UDim2` offset): use `px.fetch(px.fromUDim2)`.
- `Position` (`UDim2` offset): use `px.fetch(px.fromUDim2)`.
- `AnchorPoint` (`Vector2` normalized): no scaling.
- `BorderSizePixel` (`number`): use `px.fetch` (or prefer `UIStroke` when applicable).

## Text Objects (`TextLabel`, `TextButton`, `TextBox`)

- `TextSize` (`number`): use `px.fetch`.
- `LineHeight` (multiplier): usually no scaling unless tied to explicit pixel math.
- `TextStrokeTransparency` (`number`): no scaling.

## ScrollingFrame

- `CanvasSize` (`UDim2` offset): use `px.fetch(px.fromUDim2)`.
- `CanvasPosition` (`Vector2`): scale per component.
- `ScrollBarThickness` (`number`): use `px.fetch`.

## Layouts

- `UIGridLayout`
  - `CellSize` (`UDim2` offset): use `px.fetch(px.fromUDim2)`.
  - `CellPadding` (`UDim2` offset): use `px.fetch(px.fromUDim2)`.
- `UIListLayout`
  - `Padding` (`UDim` offset): use `px.fetch(px.fromUDim)`.
- `UITableLayout`
  - `Padding` (`UDim2` offset): use `px.fetch(px.fromUDim2)`.
- `UIPageLayout`
  - `Padding` (`UDim` offset): use `px.fetch(px.fromUDim)`.

## Constraints & Modifiers

- `UIPadding`
  - `PaddingTop` (`UDim` offset): use `px.fetch(px.fromUDim)`.
  - `PaddingBottom` (`UDim` offset): use `px.fetch(px.fromUDim)`.
  - `PaddingLeft` (`UDim` offset): use `px.fetch(px.fromUDim)`.
  - `PaddingRight` (`UDim` offset): use `px.fetch(px.fromUDim)`.
- `UICorner`
  - `CornerRadius` (`UDim` offset): use `px.fetch(px.fromUDim)`.
- `UIStroke`
  - `Thickness` (`number`): use `px.fetch`.
- `UISizeConstraint`
  - `MinSize` (`Vector2`): scale per component.
  - `MaxSize` (`Vector2`): scale per component.

## Image Objects (`ImageLabel`, `ImageButton`)

- `ImageRectSize` (`Vector2` source pixels): usually no scaling unless doing dynamic cropping logic.
- `ImageRectOffset` (`Vector2` source pixels): usually no scaling unless doing dynamic cropping logic.
- `SliceCenter` (`Rect` source slicing): no scaling.

## General Rule

If a property represents size, position, padding, or thickness in pixel offsets, scale it with `px`. Normalized scale components (`0-1`) should not be modified.
