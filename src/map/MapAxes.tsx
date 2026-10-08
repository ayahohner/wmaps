/**
 * Evolution stages and the names they go by for each kind of component
 * (Wardley's characteristics table). Stages split the x-axis into quarters.
 */
export const evolutionStages = [
  {
    name: "Genesis",
    alternatives: [
      ["Activities", "Genesis"],
      ["Practices", "Novel"],
      ["Data", "Unmodelled"],
      ["Knowledge", "Concept"],
    ],
  },
  {
    name: "Custom-Built",
    alternatives: [
      ["Activities", "Custom-Built"],
      ["Practices", "Emerging"],
      ["Data", "Divergent"],
      ["Knowledge", "Hypothesis"],
    ],
  },
  {
    name: "Product",
    alternatives: [
      ["Activities", "Product (+rental)"],
      ["Practices", "Good"],
      ["Data", "Convergent"],
      ["Knowledge", "Theory"],
    ],
  },
  {
    name: "Commodity",
    alternatives: [
      ["Activities", "Commodity (+utility)"],
      ["Practices", "Best"],
      ["Data", "Modelled"],
      ["Knowledge", "Accepted"],
    ],
  },
] as const;

/** Evolution (x) and visibility (y) axes drawn over the map canvas. */
export function MapAxes() {
  const width = 100 / evolutionStages.length;
  return (
    <>
      <div className="axis-y" aria-label="Visibility">
        <span className="axis-y-label">Visibility</span>
      </div>
      <div className="axis-x" aria-label="Evolution">
        {evolutionStages.slice(1).map((_, i) => (
          <span
            key={i}
            className="axis-x-notch"
            style={{ left: `${(i + 1) * width}%` }}
          />
        ))}
        {evolutionStages.map((stage, i) => (
          <span
            key={stage.name}
            className={`axis-x-stage${i === 0 ? " first" : ""}${
              i === evolutionStages.length - 1 ? " last" : ""
            }`}
            style={{ left: `${i * width}%`, width: `${width}%` }}
          >
            <span className="axis-x-label" tabIndex={0}>
              {stage.name}
              <span className="axis-x-popover" role="tooltip">
                <table>
                  <tbody>
                    {stage.alternatives.map(([type, name]) => (
                      <tr key={type}>
                        <th>{type}</th>
                        <td>{name}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </span>
            </span>
          </span>
        ))}
      </div>
    </>
  );
}
