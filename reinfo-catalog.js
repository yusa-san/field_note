/* 不動産情報ライブラリ API の一覧（API 操作説明から作成。tools で再生成可） */
"use strict";
const REINFO_APIS = [
 {
  "id": "XKT001",
  "name": "都市計画決定GISデータ（都市計画区域/区域区分）",
  "group": "都市計画",
  "zmin": 11,
  "key": "area_classification_ja",
  "title": "area_classification_ja",
  "params": [],
  "props": {
   "prefecture": "都道府県名",
   "city_code": "市区町村コード",
   "city_name": "市区町村名",
   "kubun_id": "区分コード",
   "decision_date": "設定年月日",
   "decision_classification": "設定区分",
   "decision_maker": "設定者名",
   "notice_number": "告示番号",
   "area_classification_ja": "区域区分",
   "first_decision_date": "当初決定日",
   "notice_number_s": "告示番号S"
  }
 },
 {
  "id": "XKT002",
  "name": "都市計画決定GISデータ（用途地域）",
  "group": "都市計画",
  "zmin": 11,
  "key": "use_area_ja",
  "title": "use_area_ja",
  "params": [],
  "props": {
   "youto_id": "用途地域分類",
   "prefecture": "都道府県名",
   "city_code": "市区町村コード",
   "city_name": "市区町村名",
   "decision_date": "区域設定年月日",
   "decision_classification": "設定区分",
   "decision_maker": "設定者名",
   "notice_number": "告示番号",
   "use_area_ja": "用途地域名",
   "u_floor_area_ratio_ja": "容積率",
   "u_building_coverage_ratio_ja": "建蔽率",
   "first_decision_date": "当初決定日",
   "notice_number_s": "告示番号S"
  }
 },
 {
  "id": "XKT003",
  "name": "都市計画決定GISデータ（立地適正化計画）",
  "group": "都市計画",
  "zmin": 11,
  "key": "kubun_name_ja",
  "title": "kubun_name_ja",
  "params": [],
  "props": {
   "prefecture": "都道府県名",
   "city_code": "行政区域コード",
   "city_name": "市区町村名",
   "decision_date": "区域設定年月日",
   "decision_classification": "設定区分",
   "decision_maker": "設定者名",
   "notice_number": "告示番号",
   "kubun_id": "区域コード",
   "kubun_name_ja": "区域名",
   "area_classification_ja": "区域区分",
   "first_decision_date": "当初決定日",
   "notice_number_s": "告示番号S"
  }
 },
 {
  "id": "XKT014",
  "name": "都市計画決定GISデータ（防火・準防火地域）",
  "group": "都市計画",
  "zmin": 11,
  "key": "fire_prevention_ja",
  "title": "fire_prevention_ja",
  "params": [],
  "props": {
   "fire_prevention_ja": "防火・準防火地域名",
   "kubun_id": "区分コード",
   "prefecture": "都道府県名",
   "city_code": "市区町村コード",
   "city_name": "市区町村名",
   "decision_date": "設定年月日",
   "decision_classification": "設定区分",
   "decision_maker": "設定者名",
   "notice_number": "告示番号",
   "first_decision_date": "当初決定日",
   "notice_number_s": "告示番号S"
  }
 },
 {
  "id": "XKT023",
  "name": "都市計画決定GISデータ（地区計画）",
  "group": "都市計画",
  "zmin": 11,
  "key": "plan_type_ja",
  "title": "plan_name",
  "params": [],
  "props": {
   "plan_name": "計画名",
   "plan_type_ja": "計画区分名",
   "kubun_id": "区分コード",
   "group_code": "行政コード",
   "decision_date": "設定年月日",
   "decision_type_ja": "設定区分名",
   "decision_maker": "設定者名",
   "notice_number": "告示番号",
   "prefecture": "都道府県名",
   "city_name": "市町村名",
   "first_decision_date": "当初決定日",
   "notice_number_s": "告示番号S"
  }
 },
 {
  "id": "XKT024",
  "name": "都市計画決定GISデータ（高度利用地区）",
  "group": "都市計画",
  "zmin": 11,
  "key": "advanced_type_ja",
  "title": "advanced_name",
  "params": [],
  "props": {
   "advanced_name": "高度名称",
   "advanced_type_ja": "高度区分名",
   "kubun_id": "区分コード",
   "group_code": "行政コード",
   "decision_date": "設定年月日",
   "decision_type_ja": "設定区分名",
   "decision_maker": "設定者名",
   "notice_number": "告示番号",
   "prefecture": "都道府県名",
   "city_name": "市町村名",
   "first_decision_date": "当初決定日",
   "notice_number_s": "告示番号S"
  }
 },
 {
  "id": "XKT030",
  "name": "都市計画決定GISデータ（都市計画道路）",
  "group": "都市計画",
  "zmin": 11,
  "key": "planning_road_ja",
  "title": "planning_road_ja",
  "params": [],
  "props": {
   "planning_road_ja": "都市計画道路種類名",
   "kubun_id": "区分コード",
   "prefecture": "都道府県名",
   "city_code": "市区町村コード",
   "city_name": "市区町村名",
   "first_decision_date": "当初決定日",
   "decision_date": "設定年月日",
   "decision_type_ja": "設定区分名",
   "decision_maker": "設定者名",
   "notice_number_s": "告示番号S",
   "notice_number": "告示番号"
  }
 },
 {
  "id": "XGT001",
  "name": "国土地理院GISデータ（指定緊急避難場所）",
  "group": "防災",
  "zmin": 11,
  "key": null,
  "title": "facility_name_ja",
  "params": [],
  "props": {
   "common_id": "共通ID",
   "prefecture_and_city": "都道府県名及び市町村名",
   "facility_name_ja": "施設・場所名",
   "address_ja": "住所",
   "flood_flag": "洪水",
   "landslide_flag": "崖崩れ、土石流及び地滑り",
   "high_tide_flag": "高潮",
   "earthquake_flag": "地震",
   "tsunami_flag": "津波",
   "large_fire_flag": "大規模な火事",
   "inland_flooding_flag": "内水氾濫",
   "volcanic_phenomenon_flag": "火山現象",
   "same_address_flag": "指定避難所との住所同一",
   "remarks": "備考"
  }
 },
 {
  "id": "XKT016",
  "name": "国土数値情報（災害危険区域）",
  "group": "防災",
  "zmin": 11,
  "key": "A48_007_name_ja",
  "title": "A48_005_ja",
  "params": [
   {
    "p": "administrativeAreaCode",
    "label": "代表行政コード",
    "req": false,
    "note": "形式はNNNNN（数字5桁） ※複数指定する場合は、「administrativeAreaCode=01101,13102」のようにカンマ区切りで指定してください。 https://nlftp.mlit.go.jp/ksj/gml/codelist/AdminiBoundary_CD.xlsxを参照。"
   }
  ],
  "props": {
   "A48_001": "都道府県名",
   "A48_002": "市町村名",
   "A48_003": "代表行政コード",
   "A48_004": "指定主体区分",
   "A48_005_ja": "区域名",
   "A48_006": "所在地",
   "A48_007": "指定理由コード",
   "A48_007_name_ja": "指定理由",
   "A48_008_ja": "指定理由詳細",
   "A48_009": "告示年月日",
   "A48_010": "告示番号",
   "A48_011": "根拠条例",
   "A48_012": "面積",
   "A48_013": "縮尺",
   "A48_014": "その他"
  }
 },
 {
  "id": "XKT020",
  "name": "国土数値情報（大規模盛土造成地マップ）",
  "group": "防災",
  "zmin": 11,
  "key": "embankment_classification",
  "title": "embankment_classification",
  "params": [],
  "props": {
   "embankment_classification": "盛土区分",
   "prefecture_code": "都道府県コード",
   "prefecture_name": "都道府県名",
   "city_code": "市区町村コード",
   "city_name": "市区町村名",
   "embankment_number": "盛土番号"
  }
 },
 {
  "id": "XKT021",
  "name": "国土数値情報（地すべり防止地区）",
  "group": "防災",
  "zmin": 11,
  "key": null,
  "title": "region_name",
  "params": [
   {
    "p": "prefectureCode",
    "label": "都道府県コード",
    "req": false,
    "note": "形式はNN（数字2桁） ※複数指定する場合は、「prefectureCode=09,14」のようにカンマ区切りで指定してください。 https://nlftp.mlit.go.jp/ksj/gml/codelist/PrefCd.html を参照。"
   },
   {
    "p": "administrativeAreaCode",
    "label": "行政コード",
    "req": false,
    "note": "形式はNNNNN（数字5桁） ※複数指定する場合は、「administrativeAreaCode=01101,13102」のようにカンマ区切りで指定してください。 https://nlftp.mlit.go.jp/ksj/gml/codelist/AdminiBoundary_CD.xlsx を参照。"
   }
  ],
  "props": {
   "prefecture_code": "都道府県コード",
   "group_code": "行政コード",
   "city_name": "市町村名",
   "region_name": "区域名",
   "address": "所在地",
   "notice_date": "告示年月日",
   "notice_number": "告示番号",
   "landslide_area": "指定面積（ha）",
   "charge_ministry_code": "所管省庁コード",
   "prefecture_name": "都道府県名",
   "charge_ministry_name": "所管省庁名"
  }
 },
 {
  "id": "XKT022",
  "name": "国土数値情報（急傾斜地崩壊危険区域）",
  "group": "防災",
  "zmin": 11,
  "key": null,
  "title": "region_name",
  "params": [
   {
    "p": "prefectureCode",
    "label": "都道府県コード",
    "req": false,
    "note": "形式はNN（数字2桁） ※複数指定する場合は、「prefectureCode=09,14」のようにカンマ区切りで指定してください。 https://nlftp.mlit.go.jp/ksj/gml/codelist/PrefCd.html を参照。"
   },
   {
    "p": "administrativeAreaCode",
    "label": "行政コード",
    "req": false,
    "note": "形式はNNNNN（数字5桁） ※複数指定する場合は、「administrativeAreaCode=01101,13102」のようにカンマ区切りで指定してください。 https://nlftp.mlit.go.jp/ksj/gml/codelist/AdminiBoundary_CD.xlsx を参照。"
   }
  ],
  "props": {
   "prefecture_code": "都道府県コード",
   "group_code": "行政コード",
   "city_name": "市町村名",
   "region_name": "区域名",
   "address": "所在地",
   "public_notice_date": "公示年月日",
   "public_notice_number": "公示番号",
   "landslide_area": "指定面積（ha）",
   "prefecture_name": "都道府県名"
  }
 },
 {
  "id": "XKT025",
  "name": "国土交通省都市局（地形区分に基づく液状化の発生傾向図）",
  "group": "防災",
  "zmin": 11,
  "key": "liquefaction_tendency_level",
  "title": "topographic_classification_name_ja",
  "params": [],
  "props": {
   "mesh_code": "メッシュコード",
   "topographic_classification_code": "微地形区分（28区分）",
   "topographic_classification_name_ja": "微地形区分の名称",
   "liquefaction_tendency_level": "液状化発生傾向の強弱(6段階区分)",
   "note": "説明"
  }
 },
 {
  "id": "XKT026",
  "name": "国土数値情報（洪水浸水想定区域（想定最大規模））",
  "group": "防災",
  "zmin": 14,
  "key": "A31a_205",
  "title": "A31a_202",
  "params": [],
  "props": {
   "A31a_201": "河川番号",
   "A31a_202": "河川名",
   "A31a_203": "河川管理番号",
   "A31a_204": "河川管理者",
   "A31a_205": "浸水深ランク"
  }
 },
 {
  "id": "XKT027",
  "name": "国土数値情報（高潮浸水想定区域）",
  "group": "防災",
  "zmin": 13,
  "key": "A49_003",
  "title": "A49_003",
  "params": [],
  "props": {
   "A49_001": "都道府県名",
   "A49_002": "都道府県コード",
   "A49_003": "浸水深区分",
   "target_year": "対象年"
  }
 },
 {
  "id": "XKT028",
  "name": "国土数値情報（津波浸水想定）",
  "group": "防災",
  "zmin": 14,
  "key": "A40_003",
  "title": "A40_003",
  "params": [],
  "props": {
   "A40_001": "都道府県名",
   "A40_002": "都道府県コード",
   "A40_003": "津波浸水深の区分",
   "target_year": "対象年"
  }
 },
 {
  "id": "XKT029",
  "name": "国土数値情報（土砂災害警戒区域）",
  "group": "防災",
  "zmin": 11,
  "key": "A33_001",
  "title": "A33_005",
  "params": [],
  "props": {
   "A33_001": "現象の種類",
   "A33_002": "区域区分",
   "A33_003": "都道府県コード",
   "A33_004": "区域番号",
   "A33_005": "区域名",
   "A33_006": "所在地",
   "A33_007": "公示日",
   "A33_008": "特別警戒未指定フラグ"
  }
 },
 {
  "id": "XST001",
  "name": "国土調査（災害履歴）",
  "group": "防災",
  "zmin": 9,
  "key": "disaster_name_ja",
  "title": "disaster_name_ja",
  "params": [
   {
    "p": "disastertype_code",
    "label": "災害分類コード",
    "req": false,
    "note": "形式はNN（数字2桁） ※災害分類コードは以下を指定可能。未指定の場合はすべて。 11: 浸水域等 12: 堤防決壊箇所等 13: 高潮浸水域等 14: 高潮破堤箇所等 21: がけ崩れ等 22: 地すべり等 23: 河道閉塞箇所等 24: 土石流等 33: 液状化 34: 地震土砂災害 37: 津波高 38: 津波浸水域 ※複数指定する場合は、「disastertype_code=11,22,37」のようにカンマ区切りで指定してください。"
   }
  ],
  "props": {
   "disastertype_code": "災害分類コード",
   "disaster_name_ja": "分類の呼称（災害種別等）",
   "disaster_date": "西暦年月日",
   "disaster_source": "資料名（発行者）"
  }
 },
 {
  "id": "XKT004",
  "name": "国土数値情報（小学校区）",
  "group": "施設・生活",
  "zmin": 11,
  "key": null,
  "title": "A27_004_ja",
  "params": [
   {
    "p": "administrativeAreaCode",
    "label": "行政区域コード",
    "req": false,
    "note": "形式はNNNNN（数字5桁） ※複数指定する場合は、「administrativeAreaCode=01101,13102」のようにカンマ区切りで指定してください。 https://nlftp.mlit.go.jp/ksj/gml/codelist/AdminiBoundary_CD.xlsxを参照。"
   }
  ],
  "props": {
   "A27_001": "行政区域コード",
   "A27_002": "設置主体",
   "A27_003": "学校コード",
   "A27_004_ja": "名称",
   "A27_005": "所在地"
  }
 },
 {
  "id": "XKT005",
  "name": "国土数値情報（中学校区）",
  "group": "施設・生活",
  "zmin": 11,
  "key": null,
  "title": "A32_004_ja",
  "params": [
   {
    "p": "administrativeAreaCode",
    "label": "行政区域コード",
    "req": false,
    "note": "形式はNNNNN（数字5桁） ※複数指定する場合は、「administrativeAreaCode=01101,13102」のようにカンマ区切りで指定してください。 https://nlftp.mlit.go.jp/ksj/gml/codelist/AdminiBoundary_CD.xlsxを参照。"
   }
  ],
  "props": {
   "A32_001": "行政区域コード",
   "A32_002": "設置主体",
   "A32_003": "学校コード",
   "A32_004_ja": "名称",
   "A32_005": "所在地"
  }
 },
 {
  "id": "XKT006",
  "name": "国土数値情報（学校）",
  "group": "施設・生活",
  "zmin": 13,
  "key": "P29_003_name_ja",
  "title": "P29_004_ja",
  "params": [],
  "props": {
   "P29_001": "行政区域コード",
   "P29_002": "学校コード",
   "P29_003": "学校分類コード",
   "P29_003_name_ja": "学校分類名",
   "P29_004_ja": "名称",
   "P29_005_ja": "所在地",
   "P29_006": "管理者コード",
   "P29_007": "休校区分",
   "P29_008": "キャンパスコード",
   "P29_009_ja": "学校名備考"
  }
 },
 {
  "id": "XKT007",
  "name": "国土数値情報（保育園・幼稚園等）",
  "group": "施設・生活",
  "zmin": 13,
  "key": "schoolClassCode_name_ja",
  "title": "preSchoolName_ja",
  "params": [],
  "props": {
   "administrativeAreaCode": "行政区域コード",
   "preSchoolName_ja": "名称",
   "schoolCode": "学校コード",
   "schoolClassCode": "学校分類コード",
   "schoolClassCode_name_ja": "学校分類名",
   "location_ja": "所在地",
   "administratorCode": "管理者コード",
   "closeSchoolCode": "休校コード",
   "welfareFacilityClassCode": "福祉施設大分類コード",
   "welfareFacilityMiddleClassCode": "福祉施設中分類コード",
   "welfareFacilityMinorClassCode": "福祉施設小分類コード"
  }
 },
 {
  "id": "XKT010",
  "name": "国土数値情報（医療機関）",
  "group": "施設・生活",
  "zmin": 13,
  "key": "P04_001_name_ja",
  "title": "P04_002_ja",
  "params": [],
  "props": {
   "P04_001": "医療機関分類",
   "P04_001_name_ja": "医療機関分類名",
   "P04_002_ja": "施設名称",
   "P04_003_ja": "所在地",
   "P04_004": "診療科目１",
   "P04_005": "診療科目２",
   "P04_006": "診療科目３",
   "P04_007": "開設者分類",
   "P04_008": "病床数",
   "P04_009": "救急告示病院",
   "P04_010": "災害拠点病院",
   "medical_subject_ja": "診療科目"
  }
 },
 {
  "id": "XKT011",
  "name": "国土数値情報（福祉施設）",
  "group": "施設・生活",
  "zmin": 13,
  "key": "P14_005_name_ja",
  "title": "P14_008_ja",
  "params": [
   {
    "p": "administrativeAreaCode",
    "label": "行政区域コード",
    "req": false,
    "note": "形式はNNNNN（数字5桁） ※複数指定する場合は、「administrativeAreaCode=01101,13102」のようにカンマ区切りで指定してください。 https://nlftp.mlit.go.jp/ksj/gml/codelist/AdminiBoundary_CD.xlsxを参照。"
   },
   {
    "p": "welfareFacilityClassCode",
    "label": "福祉施設大分類コード",
    "req": false,
    "note": "形式はNN（数字2桁） ※複数指定する場合は、「welfareFacilityClassCode=01,02」のようにカンマ区切りで指定してください。 https://nlftp.mlit.go.jp/ksj/gml/codelist/welfareInstitution_welfareFacilityMajorClassificationCode.htmlを参照。"
   },
   {
    "p": "welfareFacilityMiddleClassCode",
    "label": "福祉施設中分類コード",
    "req": false,
    "note": "形式はNNNN（数字4桁） ※複数指定する場合は、「welfareFacilityMiddleClassCode=0101,0201」のようにカンマ区切りで指定してください。 https://nlftp.mlit.go.jp/ksj/gml/codelist/welfareInstitution_welfareFacilityMiddleClassificationCode.htmlを参照。"
   },
   {
    "p": "welfareFacilityMinorClassCode",
    "label": "福祉施設小分類コード",
    "req": false,
    "note": "形式はNNNNNN（数字6桁） ※複数指定する場合は、「welfareFacilityMinorClassCode=020101,020102」のようにカンマ区切りで指定してください。 https://nlftp.mlit.go.jp/ksj/gml/codelist/welfareInstitution_welfareFacilityMinorClassificationCode.htmlを参照。"
   }
  ],
  "props": {
   "P14_001": "都道府県名",
   "P14_002": "市区町村名",
   "P14_003": "行政区域コード",
   "P14_004_ja": "所在地",
   "P14_005": "福祉施設大分類コード",
   "P14_005_name_ja": "福祉施設大分類名",
   "P14_006": "福祉施設中分類コード",
   "P14_006_name_ja": "福祉施設中分類名",
   "P14_007": "福祉施設小分類コード",
   "P14_008_ja": "名称",
   "P14_009": "管理者コード",
   "P14_010": "位置正確度コード"
  }
 },
 {
  "id": "XKT015",
  "name": "国土数値情報（駅別乗降客数）",
  "group": "施設・生活",
  "zmin": 11,
  "key": null,
  "title": "S12_001_ja",
  "params": [],
  "props": {
   "S12_001_ja": "駅名",
   "S12_001c": "駅コード",
   "S12_001g": "グループコード",
   "S12_002_ja": "運営会社",
   "S12_003_ja": "路線名",
   "S12_004": "鉄道区分",
   "S12_005": "事業者種別",
   "2011_duplicate_code": "重複コード2011",
   "2011_data_availability_code": "データ有無コード2011",
   "2011_remarks": "備考2011",
   "2011_passenger_count": "乗降客数2011",
   "2012_duplicate_code": "重複コード2012",
   "2012_data_availability_code": "データ有無コード2012",
   "2012_remarks": "備考2012",
   "2012_passenger_count": "乗降客数2012"
  }
 },
 {
  "id": "XKT017",
  "name": "国土数値情報（図書館）",
  "group": "施設・生活",
  "zmin": 13,
  "key": "P27_003_name_ja",
  "title": "P27_005_ja",
  "params": [
   {
    "p": "administrativeAreaCode",
    "label": "行政区域コード",
    "req": false,
    "note": "形式はNNNNN（数字5桁） ※複数指定する場合は、「administrativeAreaCode=01101,13102」のようにカンマ区切りで指定してください。 https://nlftp.mlit.go.jp/ksj/gml/codelist/AdminiBoundary_CD.xlsxを参照。"
   }
  ],
  "props": {
   "P27_001": "行政区域コード",
   "P27_002": "公共施設大分類",
   "P27_003": "公共施設小分類",
   "P27_003_name_ja": "公共施設小分類名",
   "P27_004": "文化施設分類",
   "P27_004_name_ja": "文化施設分類名",
   "P27_005_ja": "名称",
   "P27_006_ja": "所在地",
   "P27_007": "管理者コード",
   "P27_008": "階数",
   "P27_009": "建築年"
  }
 },
 {
  "id": "XKT018",
  "name": "国土数値情報（市区町村役場及び集会施設等）",
  "group": "施設・生活",
  "zmin": 13,
  "key": "P05_002_name_ja",
  "title": "P05_003_ja",
  "params": [],
  "props": {
   "P05_001": "行政区域コード",
   "P05_002": "施設分類コード",
   "P05_002_name_ja": "施設分類名",
   "P05_003_ja": "名称",
   "P05_004_ja": "所在地"
  }
 },
 {
  "id": "XPT001",
  "name": "不動産価格（取引価格・成約価格）情報のポイント (点)",
  "group": "価格",
  "zmin": 11,
  "key": "price_information_category_name_ja",
  "title": "u_transaction_price_total_ja",
  "params": [
   {
    "p": "from",
    "label": "取引時期From",
    "req": true,
    "note": "形式はYYYYN（数字5桁） YYYY … 西暦 N … 1～4（1:1月～3月、2:4月～6月、3:7月～9月、4:10月～12月） ※取引価格は20053（2005年第3四半期（7~9月））より指定可能 ※成約価格は20211（2021年第1四半期（1~3月））より指定可能"
   },
   {
    "p": "to",
    "label": "取引時期To",
    "req": true,
    "note": "形式はYYYYN（数字5桁） YYYY … 西暦 N … 1～4（1:1月～3月、2:4月～6月、3:7月～9月、4:10月～12月） ※取引価格は20053（2005年第3四半期（7~9月））より指定可能 ※成約価格は20211（2021年第1四半期（1~3月））より指定可能"
   },
   {
    "p": "priceClassification",
    "label": "価格情報区分コード",
    "req": false,
    "note": "形式はNN（数字2桁） 01 … 不動産取引価格情報のみ 02 … 成約価格情報のみ 未指定 … 不動産取引価格情報と成約価格情報の両方"
   },
   {
    "p": "landTypeCode",
    "label": "種類コード",
    "req": false,
    "note": "形式はNN（数字2桁） 01 … 宅地（土地） 02 … 宅地（土地と建物） 07 … 中古マンション等 10 … 農地 11 … 林地 未指定 … すべて ※複数指定する場合は、「landTypeCode=01,02,07」のようにカンマ区切りで指定してください。"
   }
  ],
  "props": {
   "price_information_category_name_ja": "価格情報区分",
   "district_code": "地区コード",
   "city_code": "市区町村コード",
   "prefecture_name_ja": "都道府県名",
   "city_name_ja": "市区町村名",
   "district_name_ja": "地区名",
   "u_transaction_price_total_ja": "取引価格（総額）",
   "u_unit_price_per_tsubo_ja": "坪単価",
   "floor_plan_name_ja": "間取り",
   "u_area_ja": "面積",
   "u_transaction_price_unit_price_square_meter_ja": "取引価格（平方メートル単価）",
   "land_shape_name_ja": "土地の形状",
   "u_land_frontage_ja": "間口",
   "u_building_total_floor_area_ja": "建物の延床面積",
   "u_construction_year_ja": "建築年",
   "building_structure_name_ja": "建物の構造",
   "land_use_name_ja": "用途地域",
   "future_use_purpose_name_ja": "今後の利用目的",
   "front_road_azimuth_name_ja": "前面道路の方位",
   "front_road_type_name_ja": "前面道路の種類",
   "u_front_road_width_ja": "前面道路の幅員",
   "u_building_coverage_ratio_ja": "建蔽率",
   "u_floor_area_ratio_ja": "容積率",
   "point_in_time_name_ja": "取引時点",
   "remark_renovation_name_ja": "改装",
   "remark_name_ja": "取引の事情等",
   "land_type_name_ja": "取引の種類",
   "use_category_name_ja": "地域",
   "building_use_name_ja": "用途"
  }
 },
 {
  "id": "XPT002",
  "name": "地価公示・地価調査のポイント (点)",
  "group": "価格",
  "zmin": 13,
  "key": "use_category_name_ja",
  "title": "u_current_years_price_ja",
  "params": [
   {
    "p": "year",
    "label": "対象年",
    "req": true,
    "note": "形式はNNNN（数字4桁） 1995～最新年（システム一般公開時点では2024）で一つのみ指定可能です。"
   },
   {
    "p": "priceClassification",
    "label": "地価情報区分コード",
    "req": false,
    "note": "形式はN（数字1桁） 0 … 国土交通省地価公示のみ 1 … 都道府県地価調査のみ 未指定 … 国土交通省地価公示と都道府県地価調査の両方"
   },
   {
    "p": "useCategoryCode",
    "label": "用途区分コード",
    "req": false,
    "note": "形式はNN（数字2桁） 00 … 住宅地 03 … 宅地見込地 05 … 商業地 07 … 準工業地 09 … 工業地 10 … 市街地調整区域内の現況宅地 13 … 市街地調整区域内の現況林地（国土交通省地価公示のみ） 20 … 林地（都道府県地価調査のみ） 未指定 … すべて ※複数指定する場合は、「useCategoryCode=00,03,05」のようにカンマ区切りで指定してください。"
   }
  ],
  "props": {
   "point_id": "地点ID",
   "target_year_name_ja": "対象年",
   "land_price_type": "地価区分",
   "prefecture_code": "都道府県コード",
   "prefecture_name_ja": "都道府県名",
   "city_code": "市区町村コード",
   "use_category_name_ja": "用途区分名",
   "standard_lot_number_ja": "標準地/基準地番号",
   "city_county_name_ja": "市郡名",
   "ward_town_village_name_ja": "区町村名",
   "place_name_ja": "地名",
   "residence_display_name_ja": "住居表示",
   "location_number_ja": "所在及び地番",
   "u_current_years_price_ja": "当年価格",
   "last_years_price": "前年価格",
   "year_on_year_change_rate": "対前年変動率",
   "u_cadastral_ja": "地積",
   "frontage_ratio": "間口比率",
   "depth_ratio": "奥行き比率",
   "building_structure_name_ja": "構造",
   "u_ground_hierarchy_ja": "地上階層",
   "u_underground_hierarchy_ja": "地下階層",
   "front_road_name_ja": "前面道路区分",
   "front_road_azimuth_name_ja": "前面道路の方位区分",
   "front_road_width": "前面道路の幅員",
   "front_road_pavement_condition": "前面道路の舗装状況",
   "side_road_azimuth_name_ja": "側道の方位区分",
   "side_road_name_ja": "側道区分",
   "gas_supply_availability": "ガスの有無",
   "water_supply_availability": "水道の有無",
   "sewer_supply_availability": "下水道の有無",
   "nearest_station_name_ja": "最寄り駅名",
   "proximity_to_transportation_facilitites": "交通施設との近接区分",
   "u_road_distance_to_nearest_station_name_ja": "最寄り駅までの道路距離",
   "usage_status_name_ja": "利用現況",
   "current_usage_status_of_surrounding_land_name_ja": "周辺の土地の利用現況",
   "area_division_name_ja": "区域区分",
   "regulations_use_category_name_ja": "法規制・用途区分",
   "regulations_altitude_district_name_ja": "法規制・高度地区",
   "regulations_fireproof_name_ja": "法規制・防火・準防火",
   "u_regulations_building_coverage_ratio_ja": "法規制・建蔽率",
   "u_regulations_floor_area_ratio_ja": "法規制・容積率",
   "regulations_forest_law_name_ja": "法規制・森林法",
   "regulations_park_law_name_ja": "法規制・公園法",
   "pause_flag": "休止フラグ",
   "usage_category_name_ja": "利用区分名",
   "location": "所在及び地番",
   "shape": "形状（間口：奥行き）",
   "front_road_condition": "前面道路の状況",
   "side_road_condition": "その他の接面道路",
   "park_forest_law": "森林法、公園法、自然環境等"
  }
 },
 {
  "id": "XKT013",
  "name": "国土数値情報（将来推計人口250mメッシュ）",
  "group": "人口・その他",
  "zmin": 11,
  "key": null,
  "title": "MESH_ID",
  "params": [],
  "props": {
   "MESH_ID": "分割地域メッシュコード",
   "SHICODE": "行政区域コード",
   "PTN_20XX": "20XX年男女計総数人口（秘匿なし）",
   "HITOKU20XX": "20XX年秘匿記号",
   "GASSAN20XX": "20XX年合算先メッシュ",
   "PT00_20XX": "20XX年男女計総数人口",
   "PT01_20XX": "20XX年男女計0～4歳人口",
   "PT02_20XX": "20XX年男女計5～9歳人口",
   "PT03_20XX": "20XX年男女計10～14歳人口",
   "PT04_20XX": "20XX年男女計15～19歳人口",
   "PT05_20XX": "20XX年男女計20～24歳人口",
   "PT06_20XX": "20XX年男女計25～29歳人口",
   "PT07_20XX": "20XX年男女計30～34歳人口",
   "PT08_20XX": "20XX年男女計35～39歳人口",
   "PT09_20XX": "20XX年男女計40～44歳人口",
   "PT10_20XX": "20XX年男女計45～49歳人口",
   "PT11_20XX": "20XX年男女計50～54歳人口",
   "PT12_20XX": "20XX年男女計55～59歳人口",
   "PT13_20XX": "20XX年男女計60～64歳人口",
   "PT14_20XX": "20XX年男女計65～69歳人口",
   "PT15_20XX": "20XX年男女計70～74歳人口",
   "PT16_20XX": "20XX年男女計75～79歳人口",
   "PT17_20XX": "20XX年男女計80～84歳人口",
   "PT18_20XX": "20XX年男女計85～89歳人口",
   "PT19_20XX": "20XX年男女計90～94歳人口",
   "PT20_20XX": "20XX年男女計95歳以上人口",
   "PTA_20XX": "20XX年男女計0～14歳人口",
   "PTB_20XX": "20XX年男女計15～64歳人口",
   "PTC_20XX": "20XX年男女計65歳以上人口",
   "PTD_20XX": "20XX年男女計75歳以上人口",
   "PTE_20XX": "20XX年男女計80歳以上人口",
   "RTA_20XX": "20XX年男女計0～14歳人口比率",
   "RTB_20XX": "20XX年男女計15～64歳人口比率",
   "RTC_20XX": "20XX年男女計65歳以上人口比率",
   "RTD_20XX": "20XX年男女計75歳以上人口比率",
   "RTE_20XX": "20XX年男女計80歳以上人口比率"
  }
 },
 {
  "id": "XKT019",
  "name": "国土数値情報（自然公園地域）",
  "group": "人口・その他",
  "zmin": 9,
  "key": "OBJ_NAME_ja",
  "title": "OBJ_NAME_ja",
  "params": [
   {
    "p": "prefectureCode",
    "label": "都道府県コード",
    "req": false,
    "note": "形式はN（数字1桁）またはNN（数字2桁） 1（北海道）～47（沖縄県）で指定可能です。 ※複数指定する場合は、「prefectureCode=9,11」のようにカンマ区切りで指定してください。 https://nlftp.mlit.go.jp/ksj/gml/codelist/PrefCd.htmlにおいて、1桁目が0のものについては、0を取り除いた値で指定してください。"
   },
   {
    "p": "districtCode",
    "label": "地区コード",
    "req": false,
    "note": "振興局区域を一意に識別するためのコードです。形式はN（数字1桁）またはNN（数字2桁）です。 ※複数指定する場合は、「districtCode=9,10」のようにカンマ区切りで指定してください。 https://nlftp.mlit.go.jp/ksj/gml/codelist/SubprefectureNameCd.htmlにおいて、1桁目が0のものについては、0を取り除いた値で指定してください。"
   }
  ],
  "props": {
   "OBJECTID": "シェープID",
   "PREFEC_CD": "都道府県コード",
   "AREA_CD": "地区コード",
   "CTV_NAME": "市町村名",
   "FIS_YEAR": "年度",
   "THEMA_NO": "主題番号",
   "LAYER_NO": "レイヤ番号",
   "AREA_SIZE": "ポリゴン面積(ha)",
   "IOSIDE_DIV": "内外区分",
   "REMARK_STR": "備考",
   "Shape_Leng": "シェープの長さ",
   "Shape_Area": "シェープの面積",
   "OBJ_NAME_ja": "シェープ名"
  }
 },
 {
  "id": "XKT031",
  "name": "国土数値情報（人口集中地区）",
  "group": "人口・その他",
  "zmin": 9,
  "key": null,
  "title": "A16_003",
  "params": [
   {
    "p": "administrativeAreaCode",
    "label": "行政区域コード",
    "req": false,
    "note": "形式はNNNNN（数字5桁） ※複数指定する場合は、「administrativeAreaCode=01101,13102」のようにカンマ区切りで指定してください。 https://nlftp.mlit.go.jp/ksj/gml/codelist/AdminiBoundary_CD.xlsxを参照。"
   }
  ],
  "props": {
   "A16_001": "DIDid",
   "A16_002": "行政区域コード",
   "A16_003": "市区町村名称",
   "A16_004": "人口集中地区符合",
   "A16_005": "人口",
   "A16_006": "面積",
   "A16_007": "前回人口",
   "A16_008": "前回面積",
   "A16_009": "全域に占める人口集中地区の人口割合",
   "A16_010": "全域に占める人口集中地区の面積割合",
   "A16_011": "国勢調査年度",
   "A16_012": "人口（男）",
   "A16_013": "人口（女）",
   "A16_014": "世帯数（総数）"
  }
 },
 {
  "id": "XNT001",
  "name": "内閣府重要土地等調査法（特別注視区域）",
  "group": "人口・その他",
  "zmin": 11,
  "key": null,
  "title": "NAME",
  "params": [],
  "props": {
   "NAME": "特別注視区域名"
  }
 }
];
