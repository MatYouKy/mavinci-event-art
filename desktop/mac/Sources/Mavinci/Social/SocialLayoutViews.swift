import SwiftUI

// MARK: Układy grafik jako dane — 1:1 z `SocialLayoutPicker` w CRM: miniatura-schemat układu (miejsca na zdjęcia z numerami,
// przyciemnienia, prostokąty, logo i linie tekstów — z tej samej definicji co render, w kolorach szablonu marki) i siatka wyboru
// („Styl grafiki” bez układu, układy marki, gotowe kolaże).

/// Schemat układu w proporcjach formatu.
struct SocialLayoutThumb: View {
    let definition: SocialLayoutDefinition
    let format: SocialFormat
    let width: Double
    var colors: SocialTemplateColors?

    private func color(_ role: String?) -> Color {
        switch role {
        case "accent": return CrmTheme.hex(colors?.accent) ?? CrmTheme.rgb(0xd3bb73)
        case "text": return CrmTheme.hex(colors?.text) ?? Color.white
        default: return CrmTheme.hex(colors?.overlay) ?? CrmTheme.rgb(0x1c1f33)
        }
    }

    var body: some View {
        // Format posta albo duża grafika (siatka profilu, panorama) — schemat w proporcjach całej grafiki.
        let height = width / definition.aspect(format)
        Canvas { context, size in
            // Skala px renderu (jak `scale` w HTML): format — szerokość / 1080, duża grafika — px kafelka na całej szerokości.
            let scale = size.width / (definition.canvas?.size.width ?? 1080)
            func box(_ element: SocialLayoutElement) -> CGRect {
                let rect = element.rect(format)
                return CGRect(x: rect.x * size.width, y: rect.y * size.height, width: rect.w * size.width, height: rect.h * size.height)
            }
            context.fill(Path(CGRect(origin: .zero, size: size)), with: .color(color(definition.background)))
            for element in definition.elements where element.type == "photo" {
                let frame = box(element)
                context.fill(Path(frame), with: .color(Color(white: 0.45).opacity(0.85)))
                let label = Text("\((element.slot ?? 0) + 1)").font(.system(size: max(8, min(frame.width, frame.height) * 0.28))).foregroundColor(.white.opacity(0.8))
                context.draw(label, at: CGPoint(x: frame.midX, y: frame.midY))
            }
            for element in definition.elements where element.type != "photo" {
                let frame = box(element)
                switch element.type {
                case "shade":
                    let tint = color(element.color)
                    let from = element.from ?? 0
                    let to = element.to ?? 0.8
                    let direction = element.direction ?? "down"
                    let start: CGPoint
                    let end: CGPoint
                    switch direction {
                    case "up": start = CGPoint(x: frame.midX, y: frame.maxY); end = CGPoint(x: frame.midX, y: frame.minY)
                    case "left": start = CGPoint(x: frame.maxX, y: frame.midY); end = CGPoint(x: frame.minX, y: frame.midY)
                    case "right": start = CGPoint(x: frame.minX, y: frame.midY); end = CGPoint(x: frame.maxX, y: frame.midY)
                    default: start = CGPoint(x: frame.midX, y: frame.minY); end = CGPoint(x: frame.midX, y: frame.maxY)
                    }
                    let gradient = Gradient(colors: [tint.opacity(from), tint.opacity(to)])
                    context.fill(Path(frame), with: .linearGradient(gradient, startPoint: start, endPoint: end))
                case "box":
                    let path = Path(roundedRect: CGRect(x: frame.minX, y: frame.minY, width: frame.width, height: max(frame.height, 0.6)),
                                    cornerRadius: (element.radius ?? 0) * scale)
                    if let fill = element.fill { context.fill(path, with: .color(color(fill.color).opacity(fill.opacity))) }
                    if let stroke = element.stroke {
                        context.stroke(path, with: .color(color(stroke.color).opacity(stroke.opacity)), lineWidth: max(0.6, stroke.width * scale))
                    }
                case "logo":
                    let inner = frame.insetBy(dx: frame.width * 0.2, dy: frame.height * 0.2)
                    context.stroke(Path(roundedRect: inner, cornerRadius: 2), with: .color(color("accent")), style: StrokeStyle(lineWidth: 0.8, dash: [2, 2]))
                default:
                    let line = max(1, min(frame.height * 0.5, (element.size ?? 30) * scale))
                    let share: Double = element.bind == "headline" ? 0.8 : element.bind == "kicker" ? 0.3 : 0.6
                    let length = frame.width * share
                    let left: Double = element.align == "left" ? frame.minX : element.align == "right" ? frame.maxX - length : frame.minX + (frame.width - length) / 2
                    let bar = CGRect(x: left, y: frame.minY + (frame.height - line) / 2, width: length, height: line)
                    context.fill(Path(roundedRect: bar, cornerRadius: line / 2), with: .color(color(element.color).opacity(0.9)))
                }
            }
        }
        .frame(width: width, height: height)
        .clipShape(RoundedRectangle(cornerRadius: 4))
    }
}

/// Siatka wyboru układu: „Styl grafiki” (bez układu) i układy (marki, gotowe).
struct SocialLayoutPickerGrid: View {
    let options: [SocialLayoutOption]
    let selection: SocialLayoutChoice?
    let format: SocialFormat
    var colors: SocialTemplateColors?
    let disabled: Bool
    let onChange: (SocialLayoutChoice?) -> Void
    @Environment(\.crmTheme) private var theme

    private func tile<Preview: View>(selected: Bool, title: String, subtitle: String, help: String, action: @escaping () -> Void,
                                     @ViewBuilder preview: () -> Preview) -> some View {
        Button(action: action) {
            VStack(spacing: 3) {
                preview()
                Text(title).font(.caption2).lineLimit(2).multilineTextAlignment(.center)
                Text(subtitle).font(.caption2).foregroundStyle(.secondary)
            }
            .padding(5)
            .frame(maxWidth: .infinity)
            .background(RoundedRectangle(cornerRadius: 8).fill(selected ? theme.accent.opacity(0.12) : Color.clear))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(selected ? theme.accent : Color.primary.opacity(0.15)))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .help(help)
    }

    var body: some View {
        let ordered = options.filter { $0.id != nil } + options.filter { $0.id == nil }
        VStack(alignment: .leading, spacing: 6) {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 78), spacing: 6)], spacing: 6) {
                tile(selected: selection == nil, title: "Styl grafiki", subtitle: "1 zdjęcie", help: "Bez układu — wygląd z wybranego stylu grafiki",
                     action: { onChange(nil) }) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 4).fill(Color.primary.opacity(0.08))
                        Image(systemName: "paintbrush").foregroundStyle(theme.accent.opacity(0.7))
                    }
                    .frame(width: 64, height: 64 / format.aspect)
                }
                ForEach(ordered, id: \.identity) { option in
                    let subtitle: String = option.slots == 1 ? "1 zdjęcie" : "\(option.slots) zdjęcia"
                    tile(selected: selection == option.choice, title: option.name + (option.archived ? " (archiwum)" : ""), subtitle: subtitle,
                         help: option.description.isEmpty ? option.name : option.description, action: { onChange(option.choice) }) {
                        SocialLayoutThumb(definition: option.definition, format: format, width: 64, colors: colors)
                    }
                }
            }
            if !options.contains(where: { $0.id != nil }) {
                Label("Gotowe układy i kolaże; własne układy marki dodasz w edytorze układów.", systemImage: "rectangle.3.group")
                    .font(.caption2).foregroundStyle(.secondary)
            }
        }
    }
}

/// Siatka profilu / panorama: kształt (siatka 3, 6, 9 kafelków; panorama 2–5 slajdów) i gotowy układ w tym kształcie —
/// 1:1 z `CanvasPicker` w CRM. Zmiana kształtu wybiera układ tego samego rodzaju w nowym kształcie (albo pierwszy).
struct SocialCanvasPicker: View {
    let options: [SocialLayoutOption]
    let selection: SocialLayoutChoice?
    let canvas: SocialLayoutCanvas?
    var colors: SocialTemplateColors?
    let disabled: Bool
    let onChange: (SocialLayoutChoice) -> Void
    @Environment(\.crmTheme) private var theme

    private var shapes: [SocialLayoutCanvas] {
        var list: [SocialLayoutCanvas] = []
        for option in options { if let shape = option.definition.canvas, !list.contains(shape) { list.append(shape) } }
        return list
    }

    /// Rodzaj układu bez liczby (np. `preset-grid-photo` dla `preset-grid-2-photo`).
    private func kind(_ key: String?) -> String {
        guard let key else { return "" }
        return key.replacingOccurrences(of: #"-\d+(-|$)"#, with: "$1", options: .regularExpression)
    }

    private func pick(_ shape: SocialLayoutCanvas) {
        let list = options.filter { $0.definition.canvas == shape }
        if let same = list.first(where: { kind($0.key) == kind(selection?.key) }) ?? list.first { onChange(same.choice) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            WrapLayout(spacing: 6) {
                ForEach(shapes, id: \.self) { shape in
                    let active = shape == canvas
                    Button { pick(shape) } label: {
                        Text(shape.shortLabel).font(.caption)
                            .padding(.horizontal, 10).padding(.vertical, 4)
                            .background(Capsule().fill(active ? theme.accent.opacity(0.18) : Color.clear))
                            .overlay(Capsule().stroke(active ? theme.accent : Color.primary.opacity(0.15)))
                            .foregroundStyle(active ? theme.accent : Color.primary)
                            .contentShape(Capsule())
                    }
                    .buttonStyle(.plain).disabled(disabled).help(shape.label)
                }
            }
            // Szerokie schematy (baner, panorama) — jedna kolumna w wąskim panelu kreatora, żeby miniatura się mieściła.
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 6)], spacing: 6) {
                ForEach(options.filter { $0.definition.canvas == canvas }, id: \.identity) { option in
                    let selected = selection == option.choice
                    let thumbWidth: Double = min(200, 64 * option.definition.aspect(.portrait))
                    Button { onChange(option.choice) } label: {
                        VStack(spacing: 3) {
                            SocialLayoutThumb(definition: option.definition, format: .portrait, width: thumbWidth, colors: colors)
                            Text(option.name).font(.caption2).lineLimit(2).multilineTextAlignment(.center)
                        }
                        .padding(5)
                        .frame(maxWidth: .infinity)
                        .background(RoundedRectangle(cornerRadius: 8).fill(selected ? theme.accent.opacity(0.12) : Color.clear))
                        .overlay(RoundedRectangle(cornerRadius: 8).stroke(selected ? theme.accent : Color.primary.opacity(0.15)))
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain).disabled(disabled).help(option.description)
                }
            }
        }
    }
}
