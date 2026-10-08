/**
 * Evolution stages and the names they go by for each kind of component
 * (Wardley's characteristics table).
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
    name: "Custom",
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

/** Evolution percentages where each stage after Genesis begins. */
export const stageBoundaries = [17.4, 40, 70] as const;

const stageEdges = [0, ...stageBoundaries, 100];

/**
 * Dashed stage boundaries, drawn beneath the (transparent) map canvas so
 * components and their labels paint over them.
 */
export function StageDividers() {
  return stageBoundaries.map((boundary) => (
    <span
      key={boundary}
      className="axis-x-divider"
      style={{ left: `${boundary}%` }}
    />
  ));
}

/** Evolution (x) and visibility (y) axes drawn over the map canvas. */
export function MapAxes() {
  return (
    <>
      <div className="axis-y" aria-label="Visibility">
        <span className="axis-y-label">Visibility</span>
      </div>
      <div className="axis-x" aria-label="Evolution">
        {evolutionStages.map((stage, i) => (
          <span
            key={stage.name}
            className={`axis-x-stage${i === 0 ? " first" : ""}${
              i === evolutionStages.length - 1 ? " last" : ""
            }`}
            style={{
              left: `${stageEdges[i]}%`,
              width: `${stageEdges[i + 1] - stageEdges[i]}%`,
            }}
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
