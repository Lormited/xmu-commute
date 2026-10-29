import { Text, View } from 'react-native';
import { useDemo } from '@/demo-context';
import { DEMO_STUDENT_ID } from '@/demo-data';
import { Badge, Button, DetailScreen, Glass, Icon, c, goBack, s } from '@/ui';
export default function Login() {
  const { dispatch } = useDemo();
  return <DetailScreen title="学校统一登录">
    <View style={s.bigIcon}><Icon name="school-outline" size={30} color={c.accent} /></View>
    <Glass style={{ padding: 24, gap: 22 }}><Badge>演示认证</Badge><View style={{ gap: 8 }}><Text selectable style={s.cardTitle}>{DEMO_STUDENT_ID}</Text><Text style={s.body}>林同学</Text></View><Text style={s.body}>仅使用虚构身份，不输入学校密码。</Text><Button label="完成演示登录" onPress={() => { dispatch({ type: 'login' }); goBack(); }} /></Glass>
  </DetailScreen>;
}
