import React, { useEffect, useState } from 'react';
import RelationGraph from './RelationGraph';
import events from '../../data/gatsby/chapter1_events.json';
import event1 from '../../data/gatsby/chapter1_relationships_event_1.json';
import event2 from '../../data/gatsby/chapter1_relationships_event_2.json';
import event3 from '../../data/gatsby/chapter1_relationships_event_3.json';
import event4 from '../../data/gatsby/chapter1_relationships_event_4.json';
import event5 from '../../data/gatsby/chapter1_relationships_event_5.json';
import event6 from '../../data/gatsby/chapter1_relationships_event_6.json';
import event7 from '../../data/gatsby/chapter1_relationships_event_7.json';
import event8 from '../../data/gatsby/chapter1_relationships_event_8.json';
import event9 from '../../data/gatsby/chapter1_relationships_event_9.json';
import event10 from '../../data/gatsby/chapter1_relationships_event_10.json';
import event11 from '../../data/gatsby/chapter1_relationships_event_11.json';
import event12 from '../../data/gatsby/chapter1_relationships_event_12.json';
import event13 from '../../data/gatsby/chapter1_relationships_event_13.json';
import event14 from '../../data/gatsby/chapter1_relationships_event_14.json';
import event15 from '../../data/gatsby/chapter1_relationships_event_15.json';
import event16 from '../../data/gatsby/chapter1_relationships_event_16.json';
import event17 from '../../data/gatsby/chapter1_relationships_event_17.json';
import event18 from '../../data/gatsby/chapter1_relationships_event_18.json';
import RelationGraphMain from './RelationGraphMain';

const eventDataMap = {
  "1": event1,
  "2": event2,
  "3": event3,
  "4": event4,
  "5": event5,
  "6": event6,
  "7": event7,
  "8": event8,
  "9": event9,
  "10": event10,
  "11": event11,
  "12": event12,
  "13": event13,
  "14": event14,
  "15": event15,
  "16": event16,
  "17": event17,
  "18": event18,
};

function getChapterNumByPosition(position) {
  return 1;
}

function getEventIdByPosition(position) {
  const event = events.find(e => position >= e.start && position < e.end);
  return event ? event.event_id : null;
}

function convertRelationsToElements(relations, idToName, idToDesc, idToMain, idToNames) {
  const nodes = {};
  const edges = [];
  relations.forEach(rel => {
    const id1 = String(rel.id1);
    const id2 = String(rel.id2);
    nodes[id1] = { data: {
      id: id1,
      label: idToName[id1] || id1,
      description: idToDesc[id1] || '',
      main_character: idToMain[id1] || false,
      names: idToNames[id1] || []
    }};
    nodes[id2] = { data: {
      id: id2,
      label: idToName[id2] || id2,
      description: idToDesc[id2] || '',
      main_character: idToMain[id2] || false,
      names: idToNames[id2] || []
    }};
    let relationLabel = '';
    if (Array.isArray(rel.relation)) {
      relationLabel = rel.relation.join(', ');
    } else if (typeof rel.relation === 'string') {
      relationLabel = rel.relation;
    }
    edges.push({
      data: {
        id: `${id1}-${id2}`,
        source: id1,
        target: id2,
        relation: relationLabel || '',
        label: relationLabel || '',
        weight: rel.weight || 1,
        positivity: rel.positivity,
        count: rel.count
      }
    });
  });
  return [...Object.values(nodes), ...edges];
}

const GraphContainer = ({ currentPosition, ...props }) => {
  const [elements, setElements] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const eventId = getEventIdByPosition(currentPosition);
    const chapterNum = getChapterNumByPosition(currentPosition);
    try {
      const eventData = eventDataMap[String(eventId + 1)];
      if (!eventData) {
        setElements([]);
        setError('해당 eventId의 관계 데이터가 없습니다.');
        return;
      }
      import('../../data/gatsby/c_chapter1_0.json').then(characters => {
        const idToName = {};
        const idToDesc = {};
        const idToMain = {};
        const idToNames = {};
        (characters.characters || characters).forEach(char => {
          const id = String(Math.trunc(char.id));
          idToName[id] = char.common_name || char.name || (Array.isArray(char.names) ? char.names[0] : String(char.id));
          idToDesc[id] = char.description || '';
          idToMain[id] = char.main_character || false;
          idToNames[id] = char.names || [];
        });
        const relations = eventData.relations || [];
        const els = convertRelationsToElements(relations, idToName, idToDesc, idToMain, idToNames);
        setElements(els);
        setLoading(false);
      });
    } catch (err) {
      setElements([]);
      setError('파일 import 실패: ' + err);
    }
  }, [currentPosition]);

  return (
    <RelationGraph
      elements={elements}
      {...props}
    />
  );
};

export default GraphContainer; 